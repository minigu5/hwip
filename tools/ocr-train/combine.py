import json, sys, glob, collections
S = '/private/tmp/claude-501/-Users-shinmingyu-Project-Latex-to-hwp/6319834a-3b9c-415c-8c8f-2c7a483b40ba/scratchpad/'
files = [S + 'full2.jsonl', S + 'mpl2.jsonl'] + sorted(glob.glob(S + '*.scored.jsonl'))
P = []
for f in files:
    for l in open(f):
        d = json.loads(l)
        if d['type'] == 'pred' and d['v'] in ('fp32', 'w8') or (d['type'] == 'pred' and f.endswith('.scored.jsonl')):
            P.append(d)
by = collections.defaultdict(dict)
for p in P: by[p['v']][p['id']] = p
scen = ['clean', 'small', 'dark', 'mpl_cm', 'mpl_stix']
print('| 변형 | 전체 | ' + ' | '.join(scen) + ' | fp32만 맞음 | 이 변형만 맞음 | ms |')
print('|---' * (len(scen) + 5) + '|')
base = by['fp32']
for v, d in by.items():
    ids = [i for i in d if i in base]
    row = [f"{sum(d[i]['vis'] for i in ids)}/{len(ids)}"]
    for s in scen:
        ii = [i for i in ids if d[i]['scen'] == s]
        row.append(f"{sum(d[i]['vis'] for i in ii)}/{len(ii)}")
    a = sum(base[i]['vis'] and not d[i]['vis'] for i in ids); b = sum(d[i]['vis'] and not base[i]['vis'] for i in ids)
    ms = sorted(d[i]['ms'] for i in ids)[len(ids) // 2]
    print(f'| {v} | ' + ' | '.join(row) + f' | {a} | {b} | {ms} |')
if len(sys.argv) > 1:
    v = sys.argv[1]
    for tag, cond in [('개선', lambda i: by[v][i]['vis'] and not base[i]['vis']), ('퇴보', lambda i: base[i]['vis'] and not by[v][i]['vis'])]:
        print(f'\n## {v} {tag}')
        for i in by[v]:
            if i in base and cond(i):
                print(f"- [{i}] gt: {base[i]['gt']}\n    fp32: {base[i]['pred'][:150]}\n    {v}: {by[v][i]['pred'][:150]}")
