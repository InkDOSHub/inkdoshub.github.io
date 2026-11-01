use egui::epaint::{ColorMode, PathStroke, Shape, StrokeKind};
use egui::{Color32, Pos2, Stroke};
use std::fmt::Write;

pub const INK: Color32 = Color32::from_rgb(0x24, 0x24, 0x24);

fn col(c: Color32) -> Option<(String, f32)> {
    let a = c.a();
    if a == 0 { return None; }
    let u = c.to_srgba_unmultiplied();
    let op = a as f32 / 255.0;
    let near = |v: u8, t: u8| (v as i32 - t as i32).abs() <= 2;
    let s = if near(u[0], 0x24) && near(u[1], 0x24) && near(u[2], 0x24) { "currentColor".to_string() } else { format!("#{:02x}{:02x}{:02x}", u[0], u[1], u[2]) };
    Some((s, op))
}
fn paint(attr: &str, c: Color32) -> String {
    match col(c) { None => format!(" {attr}=\"none\""), Some((s, o)) => if o < 0.999 { format!(" {attr}=\"{s}\" {attr}-opacity=\"{o:.2}\"") } else { format!(" {attr}=\"{s}\"") } }
}
fn st(s: &Stroke) -> String {
    if s.width <= 0.0 || s.color.a() == 0 { return " stroke=\"none\"".into(); }
    format!("{} stroke-width=\"{}\"", paint("stroke", s.color), f(s.width))
}
fn pst(s: &PathStroke) -> String {
    match s.color { ColorMode::Solid(c) => st(&Stroke::new(s.width, c)), _ => " stroke=\"none\"".into() }
}
fn f(v: f32) -> String { let r = (v * 100.0).round() / 100.0; let s = format!("{r}"); if s == "-0" { "0".into() } else { s } }
fn pts(p: &[Pos2]) -> String { p.iter().map(|q| format!("{},{}", f(q.x), f(q.y))).collect::<Vec<_>>().join(" ") }

pub fn shapes(out: &mut String, sh: &Shape) {
    match sh {
        Shape::Noop | Shape::Callback(_) | Shape::Band(_) => {}
        Shape::Vec(v) => for s in v { shapes(out, s) },
        Shape::Circle(c) => { let _ = write!(out, "<circle cx=\"{}\" cy=\"{}\" r=\"{}\"{}{}/>", f(c.center.x), f(c.center.y), f(c.radius), paint("fill", c.fill), st(&c.stroke)); }
        Shape::Ellipse(e) => { let _ = write!(out, "<ellipse cx=\"{}\" cy=\"{}\" rx=\"{}\" ry=\"{}\"{}{}{}/>", f(e.center.x), f(e.center.y), f(e.radius.x), f(e.radius.y), if e.angle != 0.0 { format!(" transform=\"rotate({} {} {})\"", f(e.angle.to_degrees()), f(e.center.x), f(e.center.y)) } else { String::new() }, paint("fill", e.fill), st(&e.stroke)); }
        Shape::LineSegment { points, stroke } => { let _ = write!(out, "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\"{}/>", f(points[0].x), f(points[0].y), f(points[1].x), f(points[1].y), st(stroke)); }
        Shape::Path(p) => {
            let tag = if p.closed { "polygon" } else { "polyline" };
            let fill = if p.closed { paint("fill", p.fill) } else { " fill=\"none\"".into() };
            let _ = write!(out, "<{tag} points=\"{}\"{}{}/>", pts(&p.points), fill, pst(&p.stroke));
        }
        Shape::Rect(r) => {
            let mut rc = r.rect;
            let w = r.stroke.width;
            match r.stroke_kind { StrokeKind::Inside => rc = rc.shrink(w / 2.0), StrokeKind::Outside => rc = rc.expand(w / 2.0), _ => {} }
            let rad = r.corner_radius.nw as f32;
            let tr = if r.angle != 0.0 { format!(" transform=\"rotate({} {} {})\"", f(r.angle.to_degrees()), f(r.rect.center().x), f(r.rect.center().y)) } else { String::new() };
            // fill uses the unshrunk rect in egui; close enough for icons
            let _ = write!(out, "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\"{}{}{}{}/>", f(rc.min.x), f(rc.min.y), f(rc.width()), f(rc.height()), if rad > 0.0 { format!(" rx=\"{}\"", f(rad)) } else { String::new() }, tr, paint("fill", r.fill), st(&r.stroke));
        }
        Shape::Text(t) => {
            let g = &t.galley;
            let text = g.job.text.clone();
            let sec = g.job.sections.first();
            let size = sec.map(|s| s.format.font_id.size).unwrap_or(10.0);
            let fam = sec.map(|s| format!("{:?}", s.format.font_id.family)).unwrap_or_default();
            let mut c = sec.map(|s| s.format.color).unwrap_or(t.fallback_color);
            if c == Color32::PLACEHOLDER { c = t.fallback_color; }
            if let Some(o) = t.override_text_color { c = o; }
            let sz = g.size();
            let rot = egui::emath::Rot2::from_angle(t.angle);
            let ctr = t.pos + rot * (sz * 0.5);
            let bold = fam.contains("bold") || fam.contains("BOLD") || fam.contains("semibold");
            let ital = fam.contains("ITALIC") || fam.contains("italic");
            let esc = text.replace('&', "&amp;").replace('<', "&lt;");
            let _ = write!(out, "<text x=\"{}\" y=\"{}\" font-size=\"{}\" text-anchor=\"middle\" dominant-baseline=\"central\"{}{}{}{}>{}</text>", f(ctr.x), f(ctr.y), f(size), if bold { " font-weight=\"600\"" } else { "" }, if ital { " font-style=\"italic\"" } else { "" }, if t.angle != 0.0 { format!(" transform=\"rotate({} {} {})\"", f(t.angle.to_degrees()), f(ctr.x), f(ctr.y)) } else { String::new() }, paint("fill", c), esc);
        }
        Shape::Mesh(m) => {
            for tri in m.indices.chunks(3) {
                if tri.len() < 3 { continue; }
                let v: Vec<Pos2> = tri.iter().map(|&i| m.vertices[i as usize].pos).collect();
                let c = m.vertices[tri[0] as usize].color;
                let _ = write!(out, "<polygon points=\"{}\"{} stroke=\"none\"/>", pts(&v), paint("fill", c));
            }
        }
        Shape::QuadraticBezier(b) => { let p = b.points; let _ = write!(out, "<path d=\"M{},{} Q{},{} {},{}{}\"{}{}/>", f(p[0].x), f(p[0].y), f(p[1].x), f(p[1].y), f(p[2].x), f(p[2].y), if b.closed { "Z" } else { "" }, if b.closed { paint("fill", b.fill) } else { " fill=\"none\"".into() }, pst(&b.stroke)); }
        Shape::CubicBezier(b) => { let p = b.points; let _ = write!(out, "<path d=\"M{},{} C{},{} {},{} {},{}{}\"{}{}/>", f(p[0].x), f(p[0].y), f(p[1].x), f(p[1].y), f(p[2].x), f(p[2].y), f(p[3].x), f(p[3].y), if b.closed { "Z" } else { "" }, if b.closed { paint("fill", b.fill) } else { " fill=\"none\"".into() }, pst(&b.stroke)); }
    }
}

pub const SIZE: f32 = 24.0;

/// Runs `draw` on a fresh context and returns the SVG body.
pub fn render(draw: impl Fn(&egui::Painter, egui::Rect)) -> String {
    let ctx = egui::Context::default();
    let out = ctx.run_ui(egui::RawInput::default(), |ui| {
        let r = egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(SIZE, SIZE));
        draw(ui.painter(), r);
    });
    let mut s = String::new();
    for cs in &out.shapes { shapes(&mut s, &cs.shape); }
    s
}

pub fn write_all(app: &str, items: Vec<(String, String)>) {
    let mut js = String::from("{\n");
    for (i, (n, b)) in items.iter().enumerate() {
        let _ = write!(js, "{}{:?}:{:?}", if i > 0 { ",\n" } else { "" }, n, b);
    }
    js.push_str("\n}\n");
    std::fs::write(format!("out/{app}.json"), js).unwrap();
}
