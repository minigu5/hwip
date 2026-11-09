"""UniMER-Train 라벨에서 합성 렌더링용 수식을 고른다.
- 평가용 벤치 수식(bench.txt)과 겹치는 라벨은 제외
- 이번 평가에서 약했던 유형(행렬·cases·mathbb·굵은 글씨 등)을 더 뽑는다
사용: python select.py <train_parquet_dir> bench.txt out.jsonl [N_uniform] [N_target]
"""
import glob, json, random, re, sys
import pyarrow.parquet as pq

random.seed(0)
src_dir, bench_path, out_path = sys.argv[1:4]
N_UNI = int(sys.argv[4]) if len(sys.argv) > 4 else 50000
N_TGT = int(sys.argv[5]) if len(sys.argv) > 5 else 30000

def key(t):  # 공백·중괄호를 지운 비교 키
    return re.sub(r'[\s{}]', '', t)

bench = {key(l) for l in open(bench_path, encoding='utf-8') if l.strip()}
texts = []
for f in sorted(glob.glob(src_dir + '/*.parquet')):
    texts += pq.read_table(f, columns=['text']).column('text').to_pylist()
print('labels', len(texts))
texts = list(dict.fromkeys(texts))  # 중복 제거
pool = [t for t in texts if 3 <= len(t.split()) <= 150 and key(t) not in bench]
print('pool', len(pool), '(dedup', len(texts), ')')

TARGETS = {
    # UniMER 라벨엔 matrix/cases 환경이 없고 \left ( \begin{array} 형태로 정규화돼 있다
    'matrix': r'\\left [(\[|] \\begin\{array\}',
    'cases': r'\\left \\\{ \\begin\{array\}',
    'array': r'\\begin\{array\}',
    'mathbb': r'\\mathbb',
    'bold': r'\\mathbf|\\boldsymbol|\\bm\b',
    'floor': r'\\lfloor|\\lceil',
    'geom': r'\\triangle|\\angle|\\overline|\\overrightarrow|\\vec',
    'accent': r'\\hat|\\bar|\\tilde|\\dot',
    'limit': r'\\lim|\\operatorname',
    'bigop': r'\\sum|\\int|\\prod|\\oint|\\iint',
}
by = {k: [t for t in pool if re.search(p, t)] for k, p in TARGETS.items()}
for k, v in by.items(): print(k, len(v))

chosen = random.sample(pool, min(N_UNI, len(pool)))
per = N_TGT // len(TARGETS)
for k, v in by.items():
    chosen += random.choices(v, k=per) if v else []
random.shuffle(chosen)
with open(out_path, 'w', encoding='utf-8') as f:
    for i, t in enumerate(chosen):
        f.write(json.dumps({'id': f'g{i:07d}', 'tex': t, 'src': 'unimer'}, ensure_ascii=False) + '\n')
print('wrote', len(chosen))
