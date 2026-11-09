import json, sys, re, os, collections
rows = [json.loads(l) for l in open(sys.argv[1])]
P = [r for r in rows if r['type'] == 'pred']
done = {r['v']: r for r in rows if r['type'] == 'done'}
MD = sys.argv[2]
size = lambda v: sum(os.path.getsize(os.path.join(MD, v, 'onnx', f)) for f in ('encoder_model.onnx', 'decoder_model_merged.onnx')) / 1e6
def toks(t):
    t = re.sub(r'\\[,;:! ]|\\quad|\\qquad|\\displaystyle', '', t)
    return [x for x in re.findall(r'\\[a-zA-Z]+|\\.|\S', t) if x not in '{}']
def ned(a, b):
    A, B = toks(a), toks(b); d = list(range(len(B) + 1))
    for i in range(1, len(A) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(B) + 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j-1] + 1, prev + (A[i-1] != B[j-1]))
    return d[len(B)] / max(1, len(B))
base = {r['id']: r['pred'] for r in P if r['v'] == 'fp32'}
by = collections.defaultdict(list)
for r in P: by[r['v']].append(r)
scens = ['clean', 'small', 'dark']
print('| 변형 | 크기 | 보기 일치(전체) | 깔끔 | 저해상도 | 다크 | HWP 출력 일치 | 토큰 오류율 | fp32와 동일 | 추론 ms |')
print('|---|---|---|---|---|---|---|---|---|---|')
for v, rs in by.items():
    n = len(rs)
    vis = sum(r['vis'] for r in rs) / n
    sv = [sum(r['vis'] for r in rs if r['scen'] == s) / max(1, sum(r['scen'] == s for r in rs)) for s in scens]
    hwp = sum(r['hwp'] for r in rs) / n
    e = sum(ned(r['pred'], r['gt']) for r in rs) / n
    same = sum(base.get(r['id']) == r['pred'] for r in rs) / n
    ms = sorted(r['ms'] for r in rs)[n // 2]
    print(f"| {v} | {size(v):.0f}MB | {vis:.1%} ({sum(r['vis'] for r in rs)}/{n}) | " + ' | '.join(f'{x:.1%}' for x in sv) + f" | {hwp:.1%} | {e:.3f} | {same:.1%} | {ms} |")
if len(sys.argv) > 3:
    v = sys.argv[3]
    print(f'\n## fp32 대비 {v} 차이')
    fp = {r['id']: r for r in by['fp32']}
    for r in by[v]:
        b = fp.get(r['id'])
        if b and b['pred'] != r['pred']:
            print(f"- [{r['id']}] gt: {r['gt']}\n    fp32({'O' if b['vis'] else 'X'}): {b['pred']}\n    {v}({'O' if r['vis'] else 'X'}): {r['pred']}")
