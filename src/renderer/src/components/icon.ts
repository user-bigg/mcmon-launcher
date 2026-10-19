const parser = new DOMParser();
const parsed = new Map<string, SVGElement>();

function parse(raw: string): SVGElement {
  const root = parser.parseFromString(raw, 'image/svg+xml').documentElement;
  if (!(root instanceof SVGElement)) {
    throw new Error('Icon is not an SVG element');
  }
  root.setAttribute('aria-hidden', 'true');
  root.removeAttribute('width');
  root.removeAttribute('height');
  return root;
}

export function svgIcon(raw: string): SVGElement {
  let template = parsed.get(raw);
  if (template === undefined) {
    template = parse(raw);
    parsed.set(raw, template);
  }
  const copy = template.cloneNode(true);
  if (!(copy instanceof SVGElement)) {
    throw new Error('Icon clone is not an SVG element');
  }
  return copy;
}
