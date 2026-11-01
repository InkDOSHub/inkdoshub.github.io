import re
KEYS=('fill','stroke','stroke-width','fill-opacity','stroke-opacity','font-size','font-weight','font-style','text-anchor','dominant-baseline')
def styl(body):
    def fix(m):
        tag=m.group(0)
        attrs=dict(re.findall(r'\s([a-z-]+)="([^"]*)"',tag))
        keep=[];sty=[]
        for k,v in attrs.items():
            if k in KEYS: sty.append(f"{k}:{v}{'px' if k=='font-size' else ''}")
            else: keep.append(f'{k}="{v}"')
        name=re.match(r'<(\w+)',tag).group(1)
        if 'stroke' not in attrs: sty.append('stroke:none')
        if 'fill' not in attrs: sty.append('fill:none')
        if name=='text': sty.append("font-family:system-ui,-apple-system,'Segoe UI',sans-serif")
        sty.append('stroke-linecap:round;stroke-linejoin:round')
        return f'<{name} '+' '.join(keep)+f' style="{";".join(sty)}"'
    return re.sub(r'<(?!/)\w+[^>]*?(?=/?>)',fix,body)
