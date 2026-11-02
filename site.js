(function () {
    var toggle = document.getElementById("theme-toggle");
    if (toggle) {
        toggle.addEventListener("click", function () {
            var dark = document.documentElement.getAttribute("data-theme") === "dark";
            var next = dark ? "light" : "dark";
            document.documentElement.setAttribute("data-theme", next);
            try { localStorage.setItem("theme", next); } catch (e) {}
        });
    }

    initMap();

    function fmt(n) {
        if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k";
        return String(n);
    }
    var links = document.querySelectorAll("[data-repo]");
    if (!links.length) return;
    var uniq = [];
    links.forEach(function (a) {
        if (uniq.indexOf(a.dataset.repo) === -1) uniq.push(a.dataset.repo);
    });
    Promise.all(uniq.map(function (repo) {
        var parts = repo.split("/");
        var owner = parts[0];
        var name = parts.slice(1).join("/");
        if (!owner || !name) return Promise.resolve([repo, null]);
        return fetch("https://api.github.com/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(name))
            .then(function (res) { return res.ok ? res.json() : null; })
            .then(function (data) {
                return [repo, data && typeof data.stargazers_count === "number" ? data.stargazers_count : null];
            })
            .catch(function () { return [repo, null]; });
    })).then(function (rows) {
        var map = {};
        rows.forEach(function (row) { map[row[0]] = row[1]; });
        links.forEach(function (a) {
            var count = map[a.dataset.repo];
            var el = a.querySelector(".star-count");
            if (count == null || !el) return;
            el.textContent = fmt(count);
            a.classList.add("stars-loaded");
        });
    });

    function initMap() {
        var map = document.querySelector(".map[data-graph]");
        var dataEl = document.getElementById("map-data");
        if (!map || !dataEl) return;
        var data = JSON.parse(dataEl.textContent);
        var NS = "http://www.w3.org/2000/svg";
        var AREA_NAMES = { infra: "AI Infrastructure", train: "Model Training", opt: "Autonomous Optimization" };
        // Area-level flows from the research overview, and which areas each one touches.
        var FLOWS = {
            arrow: { color: "infra", areas: ["infra", "train"] },
            "leg-infra": { color: "infra", areas: ["infra", "opt"] },
            "leg-train": { color: "train", areas: ["train", "opt"] },
            stem: { color: "ink", areas: ["infra", "train", "opt"] },
            "fb-left": { color: "opt", areas: ["opt", "infra"], dashed: true },
            "fb-right": { color: "opt", areas: ["opt", "train"], dashed: true }
        };
        var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        var nodes = {}, outs = {}, ins = {}, chips = {};
        data.nodes.forEach(function (n) { nodes[n.id] = n; outs[n.id] = []; ins[n.id] = []; });
        data.edges.forEach(function (e) {
            if (!nodes[e.from] || !nodes[e.to]) return;
            outs[e.from].push(e);
            ins[e.to].push(e);
        });
        map.querySelectorAll("[data-node]").forEach(function (el) { chips[el.dataset.node] = el; });
        var areas = {};
        map.querySelectorAll("[data-area]").forEach(function (el) { areas[el.dataset.area] = el; });

        map.classList.add("graph-on");
        var svg = document.createElementNS(NS, "svg");
        svg.setAttribute("class", "map-svg");
        svg.setAttribute("aria-hidden", "true");
        var defs = ["grey", "infra", "train", "opt", "ink"].map(function (c) {
            return '<marker id="mk-' + c + '" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">' +
                '<path d="M0,0 L10,5 L0,10 z" class="mk mk-' + c + '"></path></marker>';
        }).join("");
        svg.innerHTML = "<defs>" + defs + "</defs>";
        map.insertBefore(svg, map.firstChild);

        var pop = document.createElement("div");
        pop.className = "map-pop";
        pop.setAttribute("role", "dialog");
        pop.hidden = true;
        map.appendChild(pop);

        var paths = [];
        var drawn = false;
        var hovered = null;
        var pinned = null;

        function box(el) {
            var m = map.getBoundingClientRect();
            var r = el.getBoundingClientRect();
            var b = { left: r.left - m.left, right: r.right - m.left, top: r.top - m.top, bottom: r.bottom - m.top };
            b.cx = (b.left + b.right) / 2;
            b.cy = (b.top + b.bottom) / 2;
            return b;
        }

        function addPath(d, cls, color, attrs) {
            var p = document.createElementNS(NS, "path");
            p.setAttribute("d", d);
            p.setAttribute("class", cls);
            p.dataset.color = color;
            Object.keys(attrs || {}).forEach(function (k) { p.dataset[k] = attrs[k]; });
            if (cls.indexOf("no-tip") < 0) p.setAttribute("marker-end", "url(#mk-" + (cls.indexOf("dashed") >= 0 ? color : "grey") + ")");
            svg.appendChild(p);
            paths.push(p);
            return p;
        }

        function drawFlows() {
            var inf = box(areas.infra), trn = box(areas.train), opt = box(areas.opt);
            if (Math.abs(inf.top - trn.top) > 4) {
                map.classList.remove("svg-lines");
                return;
            }
            map.classList.add("svg-lines");
            var arrow = box(map.querySelector(".map-arrow"));
            var join = box(map.querySelector(".map-join"));
            var fl = box(map.querySelector(".feedback.left"));
            var fr = box(map.querySelector(".feedback.right"));
            var mid = (opt.left + opt.right) / 2;
            var yb = join.top + 34;
            var r = 10;

            addPath("M" + (inf.right + 4) + "," + arrow.cy + " H" + (trn.left - 6), "flow", "infra", { flow: "arrow" });
            addPath("M" + inf.cx + "," + inf.bottom + " V" + (yb - r) + " Q" + inf.cx + "," + yb + " " + (inf.cx + r) + "," + yb + " H" + mid,
                "flow no-tip", "infra", { flow: "leg-infra" });
            addPath("M" + trn.cx + "," + trn.bottom + " V" + (yb - r) + " Q" + trn.cx + "," + yb + " " + (trn.cx - r) + "," + yb + " H" + mid,
                "flow no-tip", "train", { flow: "leg-train" });
            addPath("M" + mid + "," + yb + " V" + (opt.top - 4), "flow", "ink", { flow: "stem" });

            var xl = inf.left + 8, xr = trn.right - 8;
            addPath("M" + opt.left + "," + fl.cy + " H" + (xl + r) + " Q" + xl + "," + fl.cy + " " + xl + "," + (fl.cy - r) + " V" + (inf.bottom + 6),
                "flow dashed", "opt", { flow: "fb-left" });
            addPath("M" + opt.right + "," + fr.cy + " H" + (xr - r) + " Q" + xr + "," + fr.cy + " " + xr + "," + (fr.cy - r) + " V" + (trn.bottom + 6),
                "flow dashed", "opt", { flow: "fb-right" });
        }

        function drawEdges() {
            data.edges.forEach(function (e) {
                if (!chips[e.from] || !chips[e.to]) return;
                var a = box(chips[e.from]), b = box(chips[e.to]);
                var d;
                if (b.top > a.bottom) {
                    var my = (a.bottom + b.top) / 2;
                    d = "M" + a.cx + "," + a.bottom + " C" + a.cx + "," + my + " " + b.cx + "," + my + " " + b.cx + "," + (b.top - 3);
                } else {
                    var y = Math.max(a.bottom, b.bottom);
                    var dip = y + 16;
                    d = "M" + a.cx + "," + (a.bottom + 1) + " C" + a.cx + "," + dip + " " + b.cx + "," + dip + " " + b.cx + "," + (b.bottom + 4);
                }
                addPath(d, "edge dashed", nodes[e.to].area, { from: e.from, to: e.to });
            });
        }

        function draw() {
            paths.forEach(function (p) { p.remove(); });
            paths = [];
            svg.setAttribute("width", map.offsetWidth);
            svg.setAttribute("height", map.offsetHeight);
            if (!map.offsetWidth) return;
            drawFlows();
            drawEdges();
            if (!drawn && map.classList.contains("in")) animateIn();
            update();
        }

        function animateIn() {
            drawn = true;
            if (reduced) return;
            paths.forEach(function (p, i) {
                var len = p.getTotalLength();
                p.style.strokeDasharray = len + " " + len;
                p.style.strokeDashoffset = len;
                p.getBoundingClientRect();
                p.style.transition = "stroke-dashoffset 0.7s ease " + (0.35 + i * 0.08) + "s";
                p.style.strokeDashoffset = "0";
                p.addEventListener("transitionend", function () {
                    p.style.strokeDasharray = "";
                    p.style.strokeDashoffset = "";
                    p.style.transition = "";
                }, { once: true });
            });
        }

        function closure(id) {
            var lit = {};
            lit[id] = true;
            function walk(start, adj, key) {
                var stack = [start];
                while (stack.length) {
                    var cur = stack.pop();
                    adj[cur].forEach(function (e) {
                        if (!lit[e[key]]) { lit[e[key]] = true; stack.push(e[key]); }
                    });
                }
            }
            walk(id, outs, "to");
            walk(id, ins, "from");
            return lit;
        }

        function update() {
            var focus = pinned || hovered;
            map.classList.toggle("focus", !!focus);
            var lit = {}, area = null;
            if (focus && focus.node) {
                lit = closure(focus.node);
                area = nodes[focus.node].area;
            } else if (focus && focus.area) {
                area = focus.area;
                data.nodes.forEach(function (n) { if (n.area === area) lit[n.id] = true; });
            }
            Object.keys(chips).forEach(function (id) {
                chips[id].classList.toggle("is-lit", !!lit[id]);
                chips[id].classList.toggle("is-active", !!(focus && focus.node === id));
            });
            Object.keys(areas).forEach(function (a) { areas[a].classList.toggle("is-lit", a === area); });
            paths.forEach(function (p) {
                var on = false;
                if (p.dataset.flow) on = !!area && FLOWS[p.dataset.flow].areas.indexOf(area) >= 0;
                else on = !!(lit[p.dataset.from] && lit[p.dataset.to]);
                p.classList.toggle("is-lit", on);
                var tip = on || p.classList.contains("dashed") ? p.dataset.color : "grey";
                if (!p.classList.contains("no-tip")) p.setAttribute("marker-end", "url(#mk-" + tip + ")");
            });
        }

        function esc(s) {
            return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
        }

        function rel(list, key, label) {
            if (!list.length) return "";
            return '<div class="pop-rel"><span>' + label + "</span> " + list.map(function (e) {
                return "<b>" + esc(nodes[e[key]].title) + "</b>" + (e.label ? " (" + esc(e.label) + ")" : "");
            }).join(", ") + "</div>";
        }

        function openPop(id) {
            var n = nodes[id];
            var chip = chips[id];
            pop.className = "map-pop " + n.area;
            pop.innerHTML = '<button class="pop-close" type="button" aria-label="Close">&times;</button>' +
                '<div class="pop-area">' + AREA_NAMES[n.area] + "</div>" +
                '<div class="pop-title">' + esc(n.title) + "</div>" +
                '<div class="pop-venue">' + esc(n.venue) + "</div>" +
                '<p class="pop-blurb">' + esc(n.blurb) + "</p>" +
                rel(ins[id], "from", "Builds on") +
                rel(outs[id], "to", "Leads to") +
                '<div class="pop-links">' + n.links.map(function (l) {
                    return '<a href="' + esc(l[1]) + '" target="_blank" rel="noopener noreferrer">' + esc(l[0]) + "</a>";
                }).join("") + '<a class="pop-more" href="' + chip.getAttribute("href") + '">Details &darr;</a></div>';
            pop.hidden = false;
            var c = box(chip);
            var w = pop.offsetWidth, h = pop.offsetHeight;
            var left = Math.max(8, Math.min(c.cx - w / 2, map.offsetWidth - w - 8));
            var top = c.bottom + 10;
            if (top + h > map.offsetHeight - 8 && c.top - h - 10 > 0) top = c.top - h - 10;
            pop.style.left = left + "px";
            pop.style.top = top + "px";
        }

        function closePop() {
            pop.hidden = true;
            pinned = null;
            update();
        }

        function target(el) {
            var chip = el.closest && el.closest("[data-node]");
            if (chip && map.contains(chip)) return { node: chip.dataset.node };
            var area = el.closest && el.closest("[data-area]");
            if (area && map.contains(area)) return { area: area.dataset.area };
            return null;
        }

        function same(a, b) {
            return !!a && !!b && a.node === b.node && a.area === b.area;
        }

        map.addEventListener("mouseover", function (ev) {
            if (pop.contains(ev.target)) return;
            var t = target(ev.target);
            if (!same(t, hovered)) { hovered = t; update(); }
        });
        map.addEventListener("mouseleave", function () { hovered = null; update(); });
        map.addEventListener("click", function (ev) {
            if (ev.target.closest(".pop-close")) { closePop(); return; }
            if (pop.contains(ev.target)) return;
            var chip = ev.target.closest("[data-node]");
            if (!chip) { if (pinned) closePop(); return; }
            ev.preventDefault();
            var id = chip.dataset.node;
            if (pinned && pinned.node === id) { closePop(); return; }
            pinned = { node: id };
            update();
            openPop(id);
        });
        document.addEventListener("click", function (ev) {
            if (pinned && !map.contains(ev.target)) closePop();
        });
        document.addEventListener("keydown", function (ev) {
            if (ev.key === "Escape" && pinned) closePop();
        });

        if ("IntersectionObserver" in window && !reduced) {
            var io = new IntersectionObserver(function (entries) {
                if (!entries[0].isIntersecting) return;
                io.disconnect();
                map.classList.add("in");
                if (!drawn) animateIn();
            }, { threshold: 0.25 });
            io.observe(map);
        } else {
            map.classList.add("in");
            drawn = true;
        }

        if (window.ResizeObserver) new ResizeObserver(draw).observe(map);
        window.addEventListener("load", draw);
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
        draw();
    }
})();
