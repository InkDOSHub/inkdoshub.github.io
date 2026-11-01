#[path = "../svg.rs"] mod svg;
#[allow(dead_code)] #[path = "../dcm/icons.rs"] mod icons;
fn main() {
    let mut v = vec![];
    for &i in icons::Icon::ALL { v.push((i.name().to_string(), svg::render(move |p, r| icons::paint(p, r, i, svg::INK, false)))); }
    svg::write_all("deckcraft", v);
}
