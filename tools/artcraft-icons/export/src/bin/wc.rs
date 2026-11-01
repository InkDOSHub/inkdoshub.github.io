#[path = "../svg.rs"] mod svg;
#[allow(dead_code)] #[path = "../wc/icons.rs"] mod icons;
mod theme { pub fn semibold(s: f32) -> egui::FontId { egui::FontId::new(s, egui::FontFamily::Name("semibold".into())) } }
fn main() {
    let names = include_str!("../wc/names.txt");
    let accent = egui::Color32::from_rgb(0x3B, 0x5B, 0xDB);
    let mut v = vec![];
    for n in names.lines() { let n2 = n.to_string(); v.push((n.to_string(), svg::render(move |p, r| icons::paint(p, r, &n2, svg::INK, accent)))); }
    svg::write_all("wordcraft", v);
}
