#[path = "../svg.rs"] mod svg;
#[allow(dead_code)] #[path = "../gc/icons.rs"] mod icons;
#[allow(dead_code)]
#[path = "../gc/all.rs"] mod all;
#[allow(dead_code)]
mod theme {
    use egui::Color32;
    pub const CELL: &str = "cell"; pub const CELL_BOLD: &str = "cellbold"; pub const CELL_ITALIC: &str = "cellITALIC";
    #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
    pub enum Cat { Blue, Green, Orange, Red, Purple, Teal, Amber, Slate }
    const fn rgb(h: u32) -> Color32 { Color32::from_rgb((h >> 16) as u8, (h >> 8) as u8, h as u8) }
    pub struct Tokens { pub paper: Color32, pub cat: [Color32; 8], pub recording: Color32 }
    impl Tokens {
        pub fn light() -> Tokens { Tokens { paper: Color32::WHITE, cat: [rgb(0x2F6FCF), rgb(0x1E8A4C), rgb(0xC8601A), rgb(0xC8372D), rgb(0x8350C8), rgb(0x13808A), rgb(0x9C6C00), rgb(0x5A6B7D)], recording: rgb(0xC42B1C) } }
        pub fn get(_c: &egui::Context) -> Tokens { Tokens::light() }
    }
}
fn main() {
    let mut v = vec![];
    for (k, &i) in all::ALL.iter().enumerate() { v.push((all::NAMES[k].to_string(), svg::render(move |p, r| icons::paint(p, r, i, svg::INK)))); }
    svg::write_all("gridcraft", v);
}
