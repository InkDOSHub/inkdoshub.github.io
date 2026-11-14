// Window classes.

use super::*;

impl Engine {
    pub(super) fn find_class(&self, name: &str, atom: u16) -> Option<usize> {
        let n = name.to_lowercase();
        if atom == 0 && n.is_empty() {
            return None;
        } // unregistered classes keep an empty name
        self.s.win.classes.iter().position(|c| if atom != 0 { c.atom == atom } else { c.name == n })
    }

    pub(super) fn add_class(&mut self, c: Class) -> u16 {
        let w = &mut self.s.win;
        if w.next_atom == 0 {
            w.next_atom = 0xC000;
        }
        let atom = match c.name.as_str() {
            "#32770" => 0x8002,
            "#32768" => 0x8000,
            "#32769" => 0x8001,
            "#32772" => 0x8004,
            _ => {
                w.next_atom += 1;
                w.next_atom
            }
        };
        w.classes.push(Class { atom, ..c });
        atom
    }

    pub(super) fn register_builtins(&mut self) {
        if self.s.win.builtins_done || self.s.win.procs_w.is_empty() {
            return;
        }
        self.s.win.builtins_done = true;
        // (name, style, proc index, extra bytes, brush)
        let list: [(&str, u32, usize, usize, u64); 13] = [
            ("#32769", 0x8, 3, 0, 2),
            ("Message", 0, 1, 0, 0),
            ("Button", 0x8 | 0x1 | 0x2 | 0x80, 7, 4 + 16, 0),
            ("ComboBox", 0x80 | 0x8 | 0x2 | 0x1, 8, 8, 0),
            ("ComboLBox", 0x8 | 0x800, 9, 8, 0),
            ("#32770", 0x800 | 0x8, 10, 30 + 8 * 3, 0),
            ("#32772", 0, 5, 0, 0),
            ("IME", 0, 15, 16, 0),
            ("ListBox", 0x8, 12, 8, 0),
            ("#32768", 0x20000 | 0x800 | 0x8, 2, 8, 5),
            ("MDIClient", 0, 13, 16, 13),
            ("ScrollBar", 0x8 | 0x2 | 0x1 | 0x80, 0, 32, 0),
            ("Static", 0x8 | 0x80, 14, 16, 0),
        ];
        for (name, style, p, extra, brush) in list.into_iter().chain([("Edit", 0x8 | 0x80, 11, 8, 0)]) {
            let (pa, pw) = (self.s.win.procs_a.get(p).copied().unwrap_or(0), self.s.win.procs_w.get(p).copied().unwrap_or(0));
            let cursor = self.std_cursor(32512);
            self.add_class(Class {
                atom: 0,
                name: name.to_lowercase(),
                style,
                proc_: pw,
                proc_a: pa,
                proc_w: pw,
                ansi: false,
                cls_extra: vec![],
                wnd_extra: extra,
                inst: 0,
                icon: 0,
                icon_sm: 0,
                cursor,
                brush,
                menu_name: 0,
                menu_name_a: 0,
                builtin: true,
            });
        }
    }

    pub(super) fn std_cursor(&mut self, _id: u32) -> u64 {
        self.new_cursor()
    }
    pub(super) fn new_cursor(&mut self) -> u64 {
        let w = &mut self.s.win;
        if w.next_cursor == 0 {
            w.next_cursor = 0x20000;
        }
        w.next_cursor += 4;
        w.cursors.insert(w.next_cursor, 0);
        w.next_cursor
    }
}
