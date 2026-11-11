"""FormulaNet 파인튜닝 — 합성(KaTeX/MathJax) 이미지 + UniMER-Train 재생 데이터.
사용: python finetune.py --out runs/ft1 [--epochs 3 --bs 32 --lr 3e-5 --replay 100000]
"""
import argparse, glob, io, json, math, os, random, re, sys, time
import torch
from torch.utils.data import DataLoader, Dataset
from PIL import Image
import pyarrow.parquet as pq

sys.path.insert(0, os.path.expanduser('~/hwip-ocr/Texo/src'))
from transformers import AutoConfig, AutoModel, VisionEncoderDecoderModel, PreTrainedTokenizerFast
from transformers.optimization import get_cosine_with_min_lr_schedule_with_warmup
from texo.model.hgnet2 import HGNetv2Config, HGNetv2
from texo.data.processor import TrainMERImageProcessor, EvalMERImageProcessor
from texo.utils.scores import compute_edit_distance

AutoConfig.register('my_hgnetv2', HGNetv2Config)
AutoModel.register(HGNetv2Config, HGNetv2)

ap = argparse.ArgumentParser()
ap.add_argument('--root', default=os.path.expanduser('~/hwip-ocr'))
ap.add_argument('--out', required=True)
ap.add_argument('--epochs', type=float, default=3)
ap.add_argument('--bs', type=int, default=32)
ap.add_argument('--accum', type=int, default=1)
ap.add_argument('--lr', type=float, default=3e-5)
ap.add_argument('--warmup', type=int, default=500)
ap.add_argument('--replay', type=int, default=100000)
ap.add_argument('--val_every', type=int, default=1000)
ap.add_argument('--workers', type=int, default=14)
ap.add_argument('--max_steps', type=int, default=0)
args = ap.parse_args()
os.makedirs(args.out, exist_ok=True)
random.seed(0); torch.manual_seed(0)
R = args.root

# 한 줄짜리 \begin{array} { r } { ... } \end{array} 감싸기는 보기상 의미가 없으므로 벗긴다
WRAP = re.compile(r'^\{? ?\\begin\{array\} \{ [rlc] \} \{ (.*) \} \\end\{array\} ?\}?$')
def clean(t):
    t = t.strip()
    m = WRAP.match(t)
    if m and '\\\\' not in m.group(1) and '\\begin{array}' not in m.group(1):
        return m.group(1)
    return t

tok = PreTrainedTokenizerFast.from_pretrained(f'{R}/model')
UNK = tok.unk_token_id
def ok_label(t):
    ids = tok(t, add_special_tokens=False)['input_ids']
    return UNK not in ids and len(ids) < 300

# 합성 데이터
syn = [json.loads(l) for l in open(f'{R}/synth/img/labels.jsonl')]
syn = [d for d in syn if os.path.exists(f'{R}/synth/img/{d["id"]}.png')]
random.shuffle(syn)
syn_val, syn_tr = syn[:1500], syn[1500:]
syn_tr = [('file', f'{R}/synth/img/{d["id"]}.png', clean(d['tex'])) for d in syn_tr]
syn_val = [('file', f'{R}/synth/img/{d["id"]}.png', clean(d['tex']), d.get('src', ''), d.get('theme', '')) for d in syn_val]

# UniMER-Train 재생 (잊어버림 방지)
replay = []
files = sorted(glob.glob(f'{R}/data/UniMER-Train/*.parquet'))
per = args.replay // len(files) + 1
for f in files:
    t = pq.read_table(f)
    idx = random.sample(range(t.num_rows), min(per, t.num_rows))
    sub = t.take(idx)
    for img, txt in zip(sub.column('image').to_pylist(), sub.column('text').to_pylist()):
        replay.append(('bytes', img, clean(txt)))
replay = replay[:args.replay]

# UniMER-Test 검증 (cpe/spe 일부)
uval = []
for name in ['spe', 'cpe', 'sce']:
    t = pq.read_table(f'{R}/data/UniMER-Test/{name}.parquet')
    idx = random.Random(1).sample(range(t.num_rows), min(300, t.num_rows))
    sub = t.take(idx)
    for img, txt in zip(sub.column('image').to_pylist(), sub.column('text').to_pylist()):
        uval.append(('bytes', img, txt.strip(), name, ''))

train = [x for x in syn_tr + replay if ok_label(x[2])]
print(f'train {len(train)} (syn {len(syn_tr)}, replay {len(replay)}), val syn {len(syn_val)}, val unimer {len(uval)}', flush=True)

class DS(Dataset):
    def __init__(self, items, proc): self.items, self.proc = items, proc
    def __len__(self): return len(self.items)
    def __getitem__(self, i):
        it = self.items[i]
        img = Image.open(it[1] if it[0] == 'file' else io.BytesIO(it[1])).convert('RGB')
        return self.proc(img), it[2]

def collate(batch):
    imgs = torch.stack([b[0] for b in batch])
    enc = tok([b[1] for b in batch], add_special_tokens=True, max_length=1024, padding='longest',
              truncation=True, return_tensors='pt', pad_to_multiple_of=8)
    ids = enc['input_ids']
    labels = ids.new_zeros(ids.shape)  # MBart 디코더: 라벨은 왼쪽으로 한 칸 (Texo collate와 동일)
    labels[:, :-1] = ids[:, 1:]
    labels[:, -1] = tok.pad_token_id
    labels[labels == tok.pad_token_id] = -100
    return imgs, ids, enc['attention_mask'], labels

model = VisionEncoderDecoderModel.from_pretrained(f'{R}/model').cuda()
model.config.decoder_start_token_id = model.decoder.config.bos_token_id
model.config.pad_token_id = model.decoder.config.pad_token_id
model.config.eos_token_id = model.decoder.config.eos_token_id

dl = DataLoader(DS(train, TrainMERImageProcessor()), batch_size=args.bs, shuffle=True, num_workers=args.workers,
                collate_fn=collate, pin_memory=True, persistent_workers=True, drop_last=True)
steps_total = args.max_steps or int(len(dl) * args.epochs / args.accum)
opt = torch.optim.AdamW(model.parameters(), lr=args.lr, betas=(0.9, 0.999), weight_decay=0.05)
sch = get_cosine_with_min_lr_schedule_with_warmup(opt, num_warmup_steps=args.warmup, num_training_steps=steps_total, min_lr=1e-7)
evalp = EvalMERImageProcessor()

def norm(s): return re.sub(r'\s+', '', s)  # 디코딩 시 '\right .'→'\right.'처럼 공백이 달라지므로 전부 무시

@torch.no_grad()
def evaluate(items):
    model.eval()
    res = {}
    for i in range(0, len(items), 48):
        chunk = items[i:i + 48]
        x = torch.stack([evalp(Image.open(c[1] if c[0] == 'file' else io.BytesIO(c[1])).convert('RGB')) for c in chunk]).cuda()
        with torch.autocast('cuda', dtype=torch.bfloat16):
            out = model.generate(x, max_length=512, num_beams=1, do_sample=False)
        preds = tok.batch_decode(out, skip_special_tokens=True)
        for c, p in zip(chunk, preds):
            g = res.setdefault(c[3] or 'all', {'n': 0, 'exact': 0, 'preds': [], 'gts': []})
            g['n'] += 1; g['exact'] += norm(p) == norm(c[2]); g['preds'].append(p); g['gts'].append(c[2])
    model.train()
    return {k: {'n': v['n'], 'exact': round(v['exact'] / v['n'], 4), 'ed': round(compute_edit_distance(v['preds'], v['gts']), 4)} for k, v in res.items()}

log = open(f'{args.out}/log.jsonl', 'a')
def record(d):
    print(json.dumps(d, ensure_ascii=False), flush=True); log.write(json.dumps(d, ensure_ascii=False) + '\n'); log.flush()

record({'step': 0, 'val_syn': evaluate(syn_val), 'val_unimer': evaluate(uval)})
model.train()
step, t0, best = 0, time.time(), -1
run_loss = 0
while step < steps_total:
    for bi, (x, ids, mask, labels) in enumerate(dl):
        x, ids, mask, labels = x.cuda(non_blocking=True), ids.cuda(), mask.cuda(), labels.cuda()
        with torch.autocast('cuda', dtype=torch.bfloat16):
            loss = model(pixel_values=x, decoder_input_ids=ids, decoder_attention_mask=mask, labels=labels).loss / args.accum
        loss.backward()
        run_loss += loss.item()
        if (bi + 1) % args.accum: continue
        torch.nn.utils.clip_grad_norm_(model.parameters(), 2.0)
        opt.step(); sch.step(); opt.zero_grad(set_to_none=True)
        step += 1
        if step % 50 == 0:
            record({'step': step, 'loss': round(run_loss / 50, 4), 'lr': sch.get_last_lr()[0], 'sec': round(time.time() - t0)})
            run_loss = 0
        if step % args.val_every == 0 or step == steps_total:
            vs, vu = evaluate(syn_val), evaluate(uval)
            # 합성(목표 분포) 정확도 + UniMER 유지 정도를 함께 본다
            score = sum(v['exact'] * v['n'] for v in vs.values()) / sum(v['n'] for v in vs.values()) \
                  - sum(v['ed'] * v['n'] for v in vu.values()) / sum(v['n'] for v in vu.values())
            record({'step': step, 'val_syn': vs, 'val_unimer': vu, 'score': round(score, 4)})
            if score > best:
                best = score
                model.save_pretrained(f'{args.out}/best'); tok.save_pretrained(f'{args.out}/best')
            model.save_pretrained(f'{args.out}/last'); tok.save_pretrained(f'{args.out}/last')
        if step >= steps_total: break
record({'done': True, 'best': best, 'sec': round(time.time() - t0)})
