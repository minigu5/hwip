"""UniMER-Test 공정 평가 — 정답·예측 양쪽에서 한 줄 array 감싸기를 벗기고 공백을 무시해 비교.
사용: python eval_unimer.py <model_dir> [per_set=1000] [hwe 포함 여부 0/1]
"""
import io, json, os, random, re, sys
import torch
import pyarrow.parquet as pq
from PIL import Image
sys.path.insert(0, os.path.expanduser('~/hwip-ocr/Texo/src'))
from transformers import AutoConfig, AutoModel, VisionEncoderDecoderModel, PreTrainedTokenizerFast
from texo.model.hgnet2 import HGNetv2Config, HGNetv2
from texo.data.processor import EvalMERImageProcessor
from texo.utils.scores import compute_edit_distance, compute_bleu
AutoConfig.register('my_hgnetv2', HGNetv2Config); AutoModel.register(HGNetv2Config, HGNetv2)

md = sys.argv[1]; per = int(sys.argv[2]) if len(sys.argv) > 2 else 1000
R = os.path.expanduser('~/hwip-ocr')
WRAP = re.compile(r'^\{? ?\\begin\{array\} \{ [rlc] \} \{ (.*) \} \\end\{array\} ?\}?$')
def clean(t):
    t = re.sub(r'\s+', ' ', t).strip()
    m = WRAP.match(t)
    if m and '\\\\' not in m.group(1) and '\\begin{array}' not in m.group(1): t = m.group(1)
    return t
tok = PreTrainedTokenizerFast.from_pretrained(f'{R}/model')
model = VisionEncoderDecoderModel.from_pretrained(md).cuda().eval()
proc = EvalMERImageProcessor()
out = {}
for name in ['spe', 'cpe', 'sce', 'hwe']:
    t = pq.read_table(f'{R}/data/UniMER-Test/{name}.parquet')
    idx = random.Random(7).sample(range(t.num_rows), min(per, t.num_rows))
    sub = t.take(idx)
    imgs, gts = sub.column('image').to_pylist(), sub.column('text').to_pylist()
    preds = []
    for i in range(0, len(imgs), 48):
        x = torch.stack([proc(Image.open(io.BytesIO(b)).convert('RGB')) for b in imgs[i:i + 48]]).cuda()
        with torch.no_grad(), torch.autocast('cuda', dtype=torch.bfloat16):
            o = model.generate(x, max_length=768, num_beams=1, do_sample=False)
        preds += tok.batch_decode(o, skip_special_tokens=True)
    # 토큰 단위 비교를 위해 디코딩 결과를 다시 토큰화해 공백으로 잇는다
    retok = lambda s: ' '.join(tok.convert_ids_to_tokens(tok(clean(s), add_special_tokens=False)['input_ids']))
    P = [retok(p) for p in preds]; G = [retok(g) for g in gts]
    out[name] = {'n': len(G), 'ed': round(compute_edit_distance(P, G), 4), 'bleu': round(compute_bleu(P, G), 4),
                 'exact': round(sum(p.replace(' ', '') == g.replace(' ', '') for p, g in zip(P, G)) / len(G), 4)}
    print(name, out[name], flush=True)
print(json.dumps({'model': md, **out}))
