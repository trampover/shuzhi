// vim:fdm=syntax
// by tuberry
/* exported setFontName setDarkBg genWaves drawWaves genBlobs
 * drawBlobs genOvals drawOvals genClouds drawClouds genTrees
 * genMotto drawMotto drawBackground drawTrees genLogo drawLogo */
'use strict';

const Cairo = imports.cairo;
const { PangoCairo, Pango, GLib, Gtk, Gdk, GdkPixbuf } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Color = Me.imports.color;

let DV = 2 / 3;
let spare = []; // cache of gauss()
let FontName = '';
let DarkBg = true;
let TextRect = [-1, -1, 0, 0];

const add = (u, v) => u + v;
const sinp = t => Math.sin(t * Math.PI);
const cosp = t => Math.cos(t * Math.PI);
const conv = (r, t) => [r * cosp(t), r * sinp(t)];
const overlap = (a, b) => !(a[0] > b[0] + b[2] || b[0] > a[0] + a[2] || a[1] > b[1] + b[3] || b[1] > a[1] + a[3]);
const forLoop = (f, u, l = 0, s = 1) => {
    if(s > 0) for(let i = l; i <= u; i += s) f(i); else for(let i = l; i >= u; i += s) f(i);
};

const rand = (l, u) => Math.random() * (u - l) + l;
const randbool = () => !!Math.round(Math.random());
const randamp = (x, y) => rand(x - y, x + y);
const randint = (l, u) => Math.floor(Math.random() * (u - l + 1)) + l;

const Y = f => f(x => Y(f)(x)); // Y combinator
const scanl = (f, xs, ac) => xs.flatMap(x => (ac = f(x, ac)));
const zipWith = (f, ...xss) => xss[0].map((_, i) => f(...xss.map(xs => xs[i])));
const array = (n, f = i => i) => Array.from({ length: n }, (_, i) => f(i));
const dis = (a, b) => Math.hypot(...zipWith((u, v) => u - v, a, b));
const dot = (xs, ys) => xs.map((x, i) => x * ys[i]).reduce(add);
const rotate = t => [[cosp(t), sinp(t), 0], [-sinp(t), cosp(t), 0]];
const move = p => [[1, 0, p[0]], [0, 1, p[1]]];
const trans = (xs, ...ms) => ms.reduce((a, m) => m.map(v => dot(v, a.concat(1))), xs); // affine
const toHex = rgba => `#${rgba.map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}`;

function setFontName(font) { FontName = font; }
function setTextRect(rect) { TextRect = rect; }
function setDarkBg(dark) { DarkBg = dark; }
function getBgColor() { return toHex(DarkBg ? Color.DARK : Color.LIGHT); }

function gauss(mu, sgm) {
    // Ref: https://en.wikipedia.org/wiki/Marsaglia_polar_method
    if(spare.length) {
        return mu + sgm * spare.pop();
    } else {
        let p, q;
        do {
            p = array(2, () => 2 * Math.random() - 1);
            q = p.reduce((a, x) => a + x ** 2, 0);
        } while(q >= 1 || q === 0);
        let r = Math.sqrt(-2 * Math.log(q) / q);
        spare.push(p[0] * r);
        return mu + sgm * p[1] * r;
    }
}

function shuffle(a) {
    // Ref: https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle#The_modern_algorithm
    forLoop(i => (j => ([a[i], a[j]] = [a[j], a[i]]))(randint(0, i)), 1, a.length - 1, -1);

    return a;
}

function genPolygon(clc, dt_a = 0.6, dt_r = 0.2, num = 6) {
    // Ref: https://stackoverflow.com/a/25276331
    let [x, y, r] = clc;
    let stp = array(num, () => randamp(1, dt_a) * 2 / num);

    return scanl(add, (m => stp.map(w => 2 * w / m))(stp.reduce(add)), rand(0, 2))
        .map(s => zipWith(add, [x, y], conv(gauss(1, dt_r) * r, s)));
}

function genCoords(rect, sum = 20, fac = 1 / 5) { // reduce collision
    // Ref: https://stackoverflow.com/a/4382286
    return Y(f => n => n === 0 ? [rect] : f(n - 1).flatMap(rc => {
        let [x, y, w, h] = rc;
        let [a, b] = [w, h].map(i => Math.round(i * randamp(1 / 2, fac)));
        return [[x, y, a, b], [x + a, y, w - a, b], [x + a, y + b, w - a, h - b], [x, y + b, a, h - b]];
    }))(Math.ceil(Math.log2(sum) / 2));
}

function circle(rect) {
    let [x, y, w, h] = rect;
    let r = Math.min(w, h) / 2;
    let ctr = w > h ? [x + rand(r, w - r), y + h / 2] : [x + w / 2, y + rand(r, h - r)];

    return ctr.concat(r);
}

function bezeirCtrls(vertex, smooth = 1, closed = false) {
    // Ref: https://zhuanlan.zhihu.com/p/267693043
    let ctrls = array(vertex.length - (closed ? 1 : 2), i => i + 1).flatMap(i => {
        let [a, b, c] = [i - 1, i, i + 1].map(x => vertex[x % vertex.length]); // i - 1 >= 0
        let ls = [a, c].map(x => dis(x, b));
        let ms = [a, c].map(x => zipWith((u, v) => (u + v) / 2, x, b));
        let ds = (k => zipWith((u, v) => u + (v - u) * k, ...ms))(ls[0] / ls.reduce(add));
        return (([x, y]) => [x, vertex[i], y])(ms.map(x => zipWith((u, v, w) => u + (v - w) * smooth, b, x, ds)));
    });

    return closed ? ctrls.splice(-1).concat(ctrls) : [vertex[0]].concat(ctrls, Array(2).fill(vertex.at(-1)));
}

function genMoon(x, _y) {
    let moon = Math.abs((Date.now() / 86400000 - 18256.8) / 29.5305882);
    let p = moon - Math.floor(moon);
    // Ref: https://ecomaan.nl/javascript/moonphase/
    let [c_x, c_y, r, s_t, e_t, t] = [x * 8 / 10, x / 10, x / 20, 0, Math.PI,  p > 0.5 ? Math.PI / 4 : -Math.PI / 4];
    p = parseFloat((1 - Math.abs(2 * p - 1)).toFixed(3));
    if(p >= 1) {
        return [c_x, c_y, r, Color.LIGHT];
    } else if(p === 0.5) {
        let g = new Cairo.LinearGradient(0, 0, 0, r / 16);
        g.addColorStopRGBA(0, 0, 0, 0, 0);
        g.addColorStopRGBA(1, 0.8, 0.8, 0.8, 1);
        return [c_x, c_y, r, s_t, e_t, t, g];
    } else if(p < 0.5) {
        let m = 1 - 2 * p;
        let n = 1 / m;
        let t1 = Math.asin((n - m) / (n + m));
        let [c_x1, c_y1, r1, s_t1, e_t1] = [0, r * (m - n) / 2, r * (n + m) / 2, t1, Math.PI - t1];
        let g = new Cairo.RadialGradient(c_x1, c_y1, r1, c_x1, c_y1, r1 + r / 16);
        g.addColorStopRGBA(0, 0, 0, 0, 0);
        g.addColorStopRGBA(1, 0.8, 0.8, 0.8, 1);
        return [c_x, c_y, r, s_t, e_t, c_x1, c_y1, r1, s_t1, e_t1, t, g];
    } else {
        let m = 2 * p - 1;
        let n = 1 / m;
        let t1 = Math.asin((n - m) / (n + m));
        let [c_x1, c_y1, r1, s_t1, e_t1] = [0, r * (n - m) / 2, r * (n + m) / 2, Math.PI + t1, 2 * Math.PI - t1];
        let g = new Cairo.RadialGradient(c_x1, c_y1, r1 - r * Math.min((n - 1) / 2, 1 / 16), c_x1, c_y1, r1);
        g.addColorStopRGBA(0, 0.8, 0.8, 0.8, 1);
        g.addColorStopRGBA(1, 0, 0, 0, 0);
        return [c_x, c_y, r, s_t, e_t, c_x1, c_y1, r1, s_t1, e_t1, t, g];
    }
}

function drawMoon(cr, pts) {
    cr.save();
    switch(pts.length) {
    case 12: {
        let [c_x, c_y, r, s_t, e_t, c_x1, c_y1, r1, s_t1, e_t1, t, g] = pts;
        cr.translate(c_x, c_y);
        cr.rotate(t);
        cr.setSource(g);
        cr.arc(0, 0, r, s_t, e_t);
        cr.arc(c_x1, c_y1, r1, s_t1, e_t1);
        cr.setFillRule(Cairo.FillRule.EVEN_ODD);
        cr.fill();
        break;
    }
    case 7: {
        let [c_x, c_y, r, s_t, e_t, t, g] = pts;
        cr.translate(c_x, c_y);
        cr.rotate(t);
        cr.setSource(g);
        cr.arc(0, 0, r, s_t, e_t);
        cr.setFillRule(Cairo.FillRule.EVEN_ODD);
        cr.fill();
        break;
    }
    case 4: {
        let [c_x, c_y, r1, color] = pts;
        cr.setSourceRGBA(...color);
        cr.arc(c_x, c_y, r1, 0, 2 * Math.PI);
        cr.fill();
        break;
    }
    }
    cr.restore();
}

function genWaves(x, y) {
    let [layers, factor, min] = [5, 1 - DV, randint(6, 9)];
    let [dt, st] = [factor * y / layers, (1 - factor) * y];
    let pts = array(layers, i => (n => bezeirCtrls(array(n + 1, j => [x * j / n, st + randamp(i, 0.7) * dt])))(min + randint(0, 5)));

    return [[x, y, Color.getRandColor(DarkBg, 1 / layers)], pts];
}

function drawWaves(cr, waves, show) {
    let [other, pts] = waves;
    let [x, y, color] = other;
    cr.save();
    cr.setSourceRGBA(...color.color);
    pts.forEach(p => {
        cr.moveTo(x, y);
        cr.lineTo(0, y);
        cr.lineTo(...p[0]);
        forLoop(i => cr.curveTo(...p[i], ...p[i + 1], ...p[i + 2]), p.length - 1, 0, 3);
        cr.closePath();
        cr.fill();
    });
    show && drawColor(cr, other);
    cr.restore();
}

function drawColor(cr, color) {
    if(!FontName) return;
    let [x, y, cl] = color;
    (fg => cr.setSourceRGBA(fg, fg, fg, 0.1))(DarkBg ? 1 : 0);
    let layout = PangoCairo.create_layout(cr);
    let desc = Pango.FontDescription.from_string(FontName);
    desc.set_size(x * Pango.SCALE / 15);
    layout.set_font_description(desc);
    layout.get_context().set_base_gravity(Pango.Gravity.EAST);
    layout.set_markup(cl.name, -1);
    cr.save();
    cr.moveTo(x, 0.03 * y);
    cr.rotate(Math.PI / 2);
    PangoCairo.show_layout(cr, layout);
    cr.restore();
}

function genBlobs(x, y) {
    return shuffle(genCoords([0, 0, x, y]))
        .filter(c => !overlap(c, TextRect))
        .slice(0, 16)
        .map(rect => [Color.getRandColor(DarkBg, 0.5).color, bezeirCtrls(genPolygon(circle(rect)), 1, true)]);
}

function drawBlobs(cr, pts) {
    cr.save();
    pts.forEach(pt => {
        let [color, p] = pt;
        cr.setSourceRGBA(...color);
        cr.moveTo(...p.at(-1));
        forLoop(i => cr.curveTo(...p[i], ...p[i + 1], ...p[i + 2]), p.length - 1, 0, 3);
        cr.fill();
    });
    cr.restore();
}

function genOvals(x, y) {
    return shuffle(genCoords([0, 0, x, y])).filter(c => !overlap(c, TextRect)).slice(0, 16).map(rect => {
        let [c_x, c_y, r] = circle(rect);
        let [e_w, e_h] = [r, gauss(1, 0.2) * r];
        return [Color.getRandColor(DarkBg, 0.5).color, [c_x, c_y, e_w, e_h, 2 * Math.random()]];
    });
}

function drawOvals(cr, pts) {
    pts.forEach(pt => {
        let color = pt[0];
        let [c_x, c_y, e_w, e_h, r_t] = pt[1];
        cr.save();
        cr.setSourceRGBA(...color);
        cr.translate(c_x, c_y);
        cr.rotate(r_t * Math.PI);
        cr.scale(e_w, e_h);
        cr.arc(0, 0, 1.0, 0, 2 * Math.PI);
        cr.fill();
        cr.restore();
    });
}

function genCloud(rect, offset) {
    let [x, y, w, h] = rect;
    let wave = a => {
        randbool() ? forLoop(i => {
            i !== 0 && a[i] < a[i - 1] && ([a[i], a[i - 1]] = [a[i - 1], a[i]]);
            i !== a.length - 1 && a[i] < a[i + 1] && ([a[i], a[i + 1]] = [a[i + 1], a[i]]);
        }, a.length - 1, 0, 2) : forLoop(i => {
            i !== 0 && a[i] > a[i - 1] && ([a[i], a[i - 1]] = [a[i - 1], a[i]]);
            i !== a.length - 1 && a[i] > a[i + 1] && ([a[i], a[i + 1]] = [a[i + 1], a[i]]);
        }, a.length - 1, 0, 2);
        return a;
    };
    let extra = (a, b) => Math.floor(a > b ? gauss(x, w * a / 4) : gauss(x + w, w * (1 - a) / 4));
    let len = Math.floor(h / offset);
    let stp = wave(shuffle(array(len, i => i / len)));
    let fst = [[extra(stp[0], stp[1]), y]];
    let result = scanl((i, ac) => ((a, b, c) => [[a, b, c], [a, b + offset, c]])(x + w * stp[i], ac.at(-1)[1], randbool()), array(len), fst);

    return fst.concat(result, [[extra(stp.at(-1), stp.at(-2)), result.at(-1)[1]]]);
}

function genClouds(x, y) {
    let offset = y / 27;
    let genRect = pt => {
        let a, b, c, d, e, f;
        switch(pt) {
        case 0: [a, b, c, d, e, f] = [0, 1 / 8, 1 / 16, 1 / 8, 2, [0, 0]]; break;
        case 1: [a, b, c, d, e, f] = [0, 1 / 8, 1 / 8, 1 / 4, 2, [0, 1 / 4]]; break;
        case 2: [a, b, c, d, e, f] = [0, 1 / 4, 0, 1 / 4, 5 / 2, [0, 2 / 4]]; break;
        case 3: [a, b, c, d, e, f] = [0, 1 / 4, 1 / 8, 1 / 4, 3, [1 / 4, 2 / 4]]; break;
        case 4: [a, b, c, d, e, f] = [0, 1 / 4, 0, 1 / 4, 5 / 2, [2 / 4, 2 / 4]]; break;
        default: [a, b, c, d, e, f] = [1 / 8, 1 / 4, 1 / 8, 1 / 4, 2, [2 / 4, 1 / 4]];
        }
        let h = randint(3 * offset, pt ? 7 * offset : 5 * offset);
        let w = randint(h * 2, e * offset * 7);
        return [randint(a * x, b * x) + f[0] * x, randint(c * y, d * y) + f[1] * y, w, h];
    };
    let coords = [[0, 2, 4], [0, 2, 5], [0, 3, 5], [1, 3, 5], [1, 3, 5]][randint(0, 4)];

    return [genMoon(x, y), coords.map(c => [Color.getRandColor(DarkBg).color, genCloud(genRect(c), offset)])];
}

function drawClouds(cr, clouds) {
    let [moon, pts] = clouds;
    drawMoon(cr, moon);
    cr.save();
    pts.forEach(pt => {
        let [color, p] = pt;
        // cr.setLineWidth(2);
        cr.setSourceRGBA(...color);
        cr.moveTo(...p[0]);
        forLoop(i => {
            let [x, y, f, d_y] = [...p[i], (p[i + 1][1] - p[i][1]) / 2];
            let flag = x < p[i + 2][0];
            cr.lineTo(x, y);
            cr.stroke();
            let [c_x, c_y, r, s_t, e_t] = [x, y + d_y, d_y, flag ? 1 / 2 : -1 / 2, flag ? 3 / 2 : 1 / 2];
            cr.arc(c_x, c_y, r, s_t * Math.PI, e_t * Math.PI);
            cr.stroke();
            f && cr.arc(flag ? c_x + r : c_x - r, c_y, r, s_t * Math.PI, e_t * Math.PI), cr.stroke();
            cr.moveTo(p[i + 1][0], p[i + 1][1]);
        }, p.length - 2, 1, 2);
        cr.lineTo(...p.at(-1));
        cr.stroke();
    });
    cr.restore();
}

function genMotto(cr, x, y, text, orien) {
    let layout = PangoCairo.create_layout(cr);
    layout.set_line_spacing(1.05);
    if(orien) {
        layout.set_width(DV * y * Pango.SCALE);
        layout.get_context().set_base_gravity(Pango.Gravity.EAST);
    } else {
        layout.set_alignment(Pango.Alignment.CENTER);
    }
    layout.set_font_description(Pango.FontDescription.from_string(FontName));
    layout.set_markup(text.replace(/SZ_BGCOLOR/g, getBgColor()), -1);
    let [fw, fh] = layout.get_pixel_size();
    let [a, b, c, d] = [x / 2, DV * y / 2, fw / 2, fh / 2];
    setTextRect(orien ? [a - d, b - c, fh, fw] : [a - c, b - d, fw, fh]);

    return [x, y, layout, orien, fw, fh];
}

function drawMotto(cr, pts) {
    let [x, y, layout, orien, fw, fh] = pts;
    cr.save();
    cr.setSourceRGBA(...DarkBg ? Color.LIGHT : Color.DARK);
    if(orien) {
        cr.moveTo((x + fh) / 2, (DV * y - fw) / 2);
        cr.rotate(Math.PI / 2);
    } else {
        cr.moveTo((x - fw) / 2, (DV * y - fh) / 2);
    }
    PangoCairo.show_layout(cr, layout);
    cr.restore();
}

function drawBackground(cr, x, y) {
    let color = DarkBg ? Color.DARK : Color.LIGHT;
    cr.save();
    cr.setSourceRGBA(...color);
    cr.rectangle(0, 0, x, y);
    cr.fill();
    cr.restore();
}

function genTrees(x, y) {
    let ld = genLand(x, y);
    let cl = Color.getRandColor();
    let t1 = genTree(6, rand(2, 5) * x / 20, 5 * y / 6, x / 30);
    let t2 = genTree(8, rand(14, 18) * x / 20, 5 * y / 6, x / 30);

    return [t1, t2, ld].map(v => v.concat([cl]));
}

function drawTrees(cr, pts) {
    let [t1, t2, ld] = pts;
    drawTree(cr, t1);
    drawTree(cr, t2);
    drawLand(cr, ld);
}

function genFlower([x, y, v, w], z, l = 20, n = 5) {
    if(z < 8) return [false, w * 0.9, [x, y], trans([x, y], move(conv(gauss(5 / 2, 1) * l, v - 1 / 2)))];
    let da = 2 / (n + 1);
    let t1 = gauss(1 / 2, 1 / 9);
    let rt = rotate(rand(0, 2));
    let fc = 1 - Math.abs(t1 * 2 - 1);
    let stp = array(n, () => gauss(1, 1 / 2 - fc));
    let tran = p => trans(p, [[1, cosp(t1) * fc, 0], [0, sinp(t1) * fc, 0]], rt, move([x, y]));

    return [sinp(t1) * fc > 0.6, scanl(add, (m => stp.map(s => s * da / m))(stp.reduce(add)), 0)
        .map((s, i) => [i, i + 1].map(t => [0.05, 0.1, 1].map(r => tran(conv(r * l, s + t * da)))))];
}

function drawFlower(cr, pts, cl) {
    cr.save();
    if(pts.length > 2) {
        let [, w, s, t] = pts;
        cr.setLineWidth(w);
        cr.setSourceRGBA(0.2, 0.2, 0.2, 0.7);
        cr.setLineCap(Cairo.LineCap.BUTT);
        cr.moveTo(...s);
        cr.lineTo(...t);
        cr.stroke();
    } else {
        let [, pt] = pts;
        cr.setSourceRGBA(...cl.color);
        pt.forEach(p => {
            cr.moveTo(...p[0][1]);
            cr.curveTo(...p[0][2], ...p[1][2], ...p[1][1]);
            cr.curveTo(...p[1][0], ...p[0][0], ...p[0][1]);
        });
        cr.fill();
    }
    cr.restore();
}

function genTree(n, x, y, l) {
    // Ref: http://fhtr.blogspot.com/2008/12/drawing-tree-with-haskell-and-cairo.html
    let branch = (vec, ang) => {
        if(!vec) return null;
        let t = vec[2] + ang * rand(0.1, 0.9);
        let s = rand(0.1, 0.9) * 3 * (1 - Math.abs(t)) ** 2;
        return s < 0.3 ? null : trans(vec.slice(0, 2), move(conv(s * l, t - 1 / 2))).concat(t);
    };
    let root = [[x, y, 0], branch([x, y, 0], gauss(0, 1 / 32))];
    let tree = root.concat(scanl((_, ac) => ac.flatMap(a => [branch(a, -1 / 4), branch(a, 1 / 4)]), array(n - 1), [root[1]]));
    let merg = (a = 0, b = 0, c) => Math.max(0.7 * (a + b) + 0.5 * (!a * b + !b * a), a * 1.2, b * 1.2) + !a * !b * 1.25 * c;
    forLoop(i => tree[i] && tree[i].push(merg(tree[2 * i]?.[3], tree[2 * i + 1]?.[3], y / 1024)), 0, tree.length - 1, -1);
    forLoop(i => tree[i] && !tree[2 * i] !== !tree[2 * i + 1] && tree[i].push(genFlower(tree[i], i, y / 54)), 2 ** n - 1, 1);

    return [tree];
}

function drawTree(cr, pts) {
    let [tr, cl] = pts;
    cr.save();
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineJoin(Cairo.LineJoin.ROUND);
    cr.setSourceRGBA(...Color.DARK);
    let lineTo = i => tr[i] && (cr.setLineWidth(tr[i][3]), cr.lineTo(tr[i][0], tr[i][1]), cr.stroke());
    let flower = (i, s) => (tr[i] && tr[i][4]) && (s === tr[i][4][0]) && drawFlower(cr, tr[i][4], cl);
    forLoop(i => {
        forLoop(j => {
            if(!tr[j]) return;
            flower(2 * j, false), cr.moveTo(tr[j][0], tr[j][1]), lineTo(2 * j);
            flower(2 * j + 1, false), cr.moveTo(tr[j][0], tr[j][1]), lineTo(2 * j + 1);
            flower(j, true);
        }, 2 ** i - 1, Math.floor(2 ** (i - 1)));
    }, Math.floor(Math.log2(tr.length)) - 1);
    cr.restore();
}

function genLand(x, y, n = 20, f = 5 / 6) {
    let land = bezeirCtrls(zipWith((u, v) => [u * x / n, v === 40 ? f * y : gauss(v * y / 48, y / 96)],
        array(10, i => i + 5), [40, 40, 42, 44, 45, 46, 46, 43, 40, 40]), 0.3);
    return [y / 1024, [0, 7 * y / 8, x, y / 8], land.concat([[x, f * y], [x, y], [0, y], [0, f * y]])];
}

function drawLand(cr, pts) {
    let [sf, rc, ld, cl] = pts;
    cr.save();
    cr.setSourceRGBA(...cl.color.slice(0, 3), 0.4);
    cr.rectangle(...rc);
    cr.fill();
    cr.setSourceRGBA(...Color.LIGHT);
    forLoop(i => cr.curveTo(...ld[i], ...ld[i + 1], ...ld[i + 2]), 26, 0, 3);
    forLoop(i => cr.lineTo(...ld[i]), 30, 27);
    cr.fill();
    cr.moveTo(...ld.at(-1));
    cr.lineTo(...ld[0]);
    forLoop(i => cr.curveTo(...ld[i], ...ld[i + 1], ...ld[i + 2]), 26, 0, 3);
    cr.lineTo(...ld.at(-4));
    cr.setSourceRGBA(0, 0, 0, 0.4);
    cr.setLineWidth(sf * 2);
    cr.stroke();
    cr.restore();
}

function genLogo(motto, x, y) {
    try {
        let g_logo = () => GLib.get_os_info('LOGO') || (DarkBg ? 'gnome-logo-text-dark' : 'gnome-logo-text');
        let path = motto && motto.replace(/^~/, GLib.get_home_dir()) ||
            (logo => logo && logo.get_filename())(new Gtk.IconTheme().lookup_icon(g_logo(), null, null));
        let image = GdkPixbuf.Pixbuf.new_from_file(path);
        ((w, h) => setTextRect([(x - w) / 2, (y * 0.8 - h) / 2, w, h]))(image.get_width(), image.get_height());
        return [image, TextRect[0], TextRect[1]];
    } catch(e) {
        return [];
    }
}

function drawLogo(cr, pts) {
    if(!pts.length) return;
    cr.save();
    Gdk.cairo_set_source_pixbuf(cr, ...pts);
    cr.paint();
    cr.restore();
}
