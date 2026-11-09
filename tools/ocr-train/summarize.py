"""autopilot 결과 요약: 체크포인트별 브라우저 벤치(재채점) + UniMER 공정 평가."""
import json, os, sys
R = sys.argv[1]
scen = ['clean', 'small', 'dark', 'mpl_cm', 'mpl_stix']
rows, preds = {}, {}
for C in ['base', 'mid', 'best', 'last']:
    vis = {}
    for SRC in ['mj', 'mpl']:
        f, rs = f'{R}/{C}-{SRC}.jsonl', f'{R}/{C}-{SRC}.rescore.json'
        if not (os.path.exists(f) and os.path.exists(rs)): continue
        m = {r['id']: r['vis2'] for r in json.load(open(rs))}
        for l in open(f):
            d = json.loads(l)
            if d['type'] == 'pred': vis[d['id']] = (m.get(d['id'], False), d['scen'], d['pred'], d['gt'])
    if not vis: continue
    preds[C] = vis
    u = {}
    try: u = json.loads(open(f'{R}/{C}-unimer.json').read())
    except Exception: pass
    rows[C] = (vis, u)
print('# 체크포인트 비교 (w8 압축본, 서버 헤드리스 Chrome)\n')
print('| 체크포인트 | 벤치 전체 | ' + ' | '.join(scen) + ' | UniMER ed (spe/cpe/sce/hwe, 낮을수록 좋음) |')
print('|---' * (len(scen) + 3) + '|')
for C, (vis, u) in rows.items():
    tot = f"{sum(v[0] for v in vis.values())}/{len(vis)}"
    per = [f"{sum(v[0] for v in vis.values() if v[1] == s)}/{sum(1 for v in vis.values() if v[1] == s)}" for s in scen]
    ue = '/'.join(str(u.get(k, {}).get('ed', '-')) for k in ['spe', 'cpe', 'sce', 'hwe'])
    print(f'| {C} | {tot} | ' + ' | '.join(per) + f' | {ue} |')
if 'base' in preds:
    for C in preds:
        if C == 'base': continue
        b, c = preds['base'], preds[C]
        imp = [i for i in c if i in b and c[i][0] and not b[i][0]]
        reg = [i for i in c if i in b and b[i][0] and not c[i][0]]
        print(f'\n## {C}: 개선 {len(imp)} / 퇴보 {len(reg)}')
        for tag, ids in [('개선', imp[:12]), ('퇴보', reg[:12])]:
            for i in ids:
                print(f'- {tag} [{i}] gt: {b[i][3]}\n  - base: {b[i][2][:140]}\n  - {C}: {c[i][2][:140]}')
