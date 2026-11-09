import json, re, sys, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
src = open(sys.argv[1]).read()
forms = [json.loads(m) for m in re.findall(r'^(".*"),?$', src, re.M)]
out = []
for i, t in enumerate(forms):
    for fs in ['cm', 'stix']:
        plt.rcParams['mathtext.fontset'] = fs
        fig = plt.figure(figsize=(0.01, 0.01))
        try:
            fig.text(0, 0, '$' + t + '$', fontsize=22)
            name = f'{i}_{fs}.png'
            fig.savefig('web/mpl/' + name, dpi=110, bbox_inches='tight', pad_inches=0.15, facecolor='white')
            out.append({'fi': i, 'scen': 'mpl_' + fs, 'gt': t, 'file': 'mpl/' + name})
        except Exception as e:
            pass
        plt.close(fig)
json.dump(out, open('web/mpl/list.json', 'w'), ensure_ascii=False)
print(len(out), 'images;', len({o['fi'] for o in out}), 'formulas')
