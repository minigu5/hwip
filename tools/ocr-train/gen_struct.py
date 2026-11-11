"""행렬·연립방정식(cases) 합성 수식 생성.
렌더링은 사용자가 실제로 보는 pmatrix/cases 등으로, 라벨은 UniMER 규약(\\left ( \\begin{array} ...)으로 만든다.
출력 JSONL: {id, tex(라벨), render(렌더용), src}
사용: python gen_struct.py out.jsonl N_matrix N_cases
"""
import json, random, sys
random.seed(1)
out, NM, NC = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])

LET = list('abcdefghkmnpqrstuvwxyz') + list('ABCDMNPQRS')
GRK = ['\\alpha', '\\beta', '\\gamma', '\\theta', '\\lambda', '\\mu', '\\sigma', '\\phi', '\\omega']
sp = lambda s: ' '.join(s)  # '12' -> '1 2'

def num():
    n = random.choice([0, 1, 1, 2, 3, 4, 5, 6, 7, 8, 9, random.randint(10, 99)])
    s = sp(str(n))
    return ('- ' + s) if (n and random.random() < 0.25) else s

def atom():
    r = random.random()
    if r < 0.35: return num()
    if r < 0.6: return random.choice(LET)
    if r < 0.7: return random.choice(GRK)
    if r < 0.8: return f'{random.choice("axy")} _ {{ {random.randint(1, 4)} {random.randint(1, 4)} }}'
    if r < 0.87: return f'\\frac {{ {num().lstrip("- ") or "1"} }} {{ {random.choice(["2","3","4","5"])} }}'
    if r < 0.93: return random.choice(['\\cos \\theta', '\\sin \\theta', '- \\sin \\theta', '\\sqrt { 2 }', 'e ^ { x }', 'x ^ { 2 }'])
    return f'{random.choice(LET)} {random.choice(["+", "-"])} {random.choice(["1", "2", random.choice(LET)])}'

def term(v):
    c = random.choice(['', '', '2 ', '3 ', '- ', '4 ', '5 '])
    return c + v

def lin_eq(vars_):
    k = random.randint(2, len(vars_))
    vs = random.sample(vars_, k)
    s = term(vs[0])
    for v in vs[1:]:
        c = random.choice(['', '2 ', '3 ', '4 '])
        s += f' {random.choice(["+", "-"])} {c}{v}'
    rhs = num()
    return f'{s} = {rhs}'

ENVS = [('pmatrix', '(', ')', 0.5), ('bmatrix', '[', ']', 0.3), ('vmatrix', '|', '|', 0.15), ('Bmatrix', '\\{', '\\}', 0.05)]

def matrix():
    env, l, r, _ = random.choices(ENVS, weights=[e[3] for e in ENVS])[0]
    rows = random.choice([1, 2, 2, 2, 3, 3, 3, 4])
    cols = random.choice([1, 2, 2, 3, 3, 4]) if rows > 1 else random.choice([2, 3, 4])
    ident = random.random() < 0.08 and rows == cols
    cells = [[('1' if i == j else '0') if ident else atom() for j in range(cols)] for i in range(rows)]
    body_r = ' \\\\ '.join(' & '.join(row) for row in cells)
    body_l = ' \\\\ '.join(' & '.join('{ ' + c + ' }' for c in row) for row in cells)
    render = f'\\begin{{{env}}} {body_r} \\end{{{env}}}'
    label = f'\\left {l} \\begin{{array}} {{ {" ".join("c" * cols)} }} {body_l} \\end{{array}} \\right {r}'
    return render, label

def matrix_expr():
    a_r, a_l = matrix()
    p = random.random()
    if p < 0.35:
        name = random.choice(['A', 'B', 'M', 'P', 'R', 'X'])
        pre = random.choice([f'{name} = ', f'{name} ^ {{ - 1 }} = ', f'{name} ^ {{ T }} = ', f'\\det {name} = ' if a_r.startswith('\\begin{vmatrix}') else f'{name} = '])
        return pre + a_r, pre + a_l
    if p < 0.55:
        b_r, b_l = matrix()
        return f'{a_r} {b_r}', f'{a_l} {b_l}'
    if p < 0.65:
        b_r, b_l = matrix()
        return f'{a_r} = {b_r}', f'{a_l} = {b_l}'
    if p < 0.72:
        f = f'\\frac {{ 1 }} {{ {random.choice(["a d - b c", "2", "\\det A", "5"])} }}'
        return f'A ^ {{ - 1 }} = {f} {a_r}', f'A ^ {{ - 1 }} = {f} {a_l}'
    return a_r, a_l

def cases():
    p = random.random()
    if p < 0.45:  # 연립방정식
        vars_ = random.choice([['x', 'y'], ['x', 'y'], ['x', 'y', 'z'], ['a', 'b']])
        rows = [lin_eq(vars_) for _ in range(random.choice([2, 2, 3]) if len(vars_) < 3 else 3)]
        render = '\\begin{cases} ' + ' \\\\ '.join(rows) + ' \\end{cases}'
        label = '\\left \\{ \\begin{array} { l } ' + ' \\\\ '.join('{ ' + r + ' }' for r in rows) + ' \\end{array} \\right .'
        return render, label
    # 조각 함수
    fn = random.choice(['f ( x ) = ', 'g ( x ) = ', '| x | = ', 'y = ', 'h ( t ) = '])
    v = 't' if 't )' in fn else 'x'
    n = random.choice([2, 2, 3])
    bounds = sorted(random.sample(range(-3, 6), n - 1))
    exprs = [random.choice([f'{v} ^ {{ 2 }}', f'- {v}', f'{v}', f'2 {v} + 1', f'\\frac {{ 1 }} {{ {v} }}', '0', '1', f'\\sin {v}', f'{v} - 1', f'e ^ {{ {v} }}', f'\\sqrt {{ {v} }}']) for _ in range(n)]
    conds = []
    for i in range(n):
        if i == 0: conds.append(f'{v} < {sp(str(bounds[0]))}'.replace('- ', '-') if bounds[0] >= 0 else f'{v} < - {sp(str(-bounds[0]))}')
        elif i == n - 1: conds.append(f'{v} \\geq {sp(str(bounds[-1]))}' if bounds[-1] >= 0 else f'{v} \\geq - {sp(str(-bounds[-1]))}')
        else:
            a, b = bounds[i - 1], bounds[i]
            fa = sp(str(a)) if a >= 0 else '- ' + sp(str(-a))
            fb = sp(str(b)) if b >= 0 else '- ' + sp(str(-b))
            conds.append(f'{fa} \\leq {v} < {fb}')
    rows_r = [f'{e} & {c}' for e, c in zip(exprs, conds)]
    rows_l = [f'{{ {e} }} & {{ {c} }}' for e, c in zip(exprs, conds)]
    render = fn + '\\begin{cases} ' + ' \\\\ '.join(rows_r) + ' \\end{cases}'
    label = fn + '\\left \\{ \\begin{array} { l l } ' + ' \\\\ '.join(rows_l) + ' \\end{array} \\right .'
    return render, label

with open(out, 'w', encoding='utf-8') as f:
    i = 0
    for _ in range(NM):
        r, l = matrix_expr(); f.write(json.dumps({'id': f'm{i:06d}', 'tex': l, 'render': r, 'src': 'matrix'}, ensure_ascii=False) + '\n'); i += 1
    for _ in range(NC):
        r, l = cases(); f.write(json.dumps({'id': f'c{i:06d}', 'tex': l, 'render': r, 'src': 'cases'}, ensure_ascii=False) + '\n'); i += 1
print('wrote', NM + NC)
