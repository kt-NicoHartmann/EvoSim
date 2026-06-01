// ===============================================
//  EVOSIM -- Hauptlogik
// ===============================================

const simCanvas = document.getElementById('simCanvas');
const ctx = simCanvas.getContext('2d');
const chartCanvas = document.getElementById('chartCanvas');
const cctx = chartCanvas.getContext('2d');

// --- Zustand ---
let running = false;
let animFrame = null;
let tick = 0;
let generation = 0;
let totalDead = 0;
let totalBorn = 0;
let creatures = [];
let foods = [];
let predators = [];
let poisonZones = [];
let activeEvent = null;
let eventTimer = 0;

// Genetrend-Daten
const trendHistory = {
    speed: [],
    sight: [],
    size: []
};
const MAX_HISTORY = 200;

// --- Parameter (Standard) ---
let P = {
    creatureCount: 40,
    foodCount: 80,
    speed: 1,
    mutation: 0.05,
    gSpeed: 1.5,
    gSight: 80,
    gSize: 8,
};

// --- Resize ---
function resizeCanvases() {
    const wr = simCanvas.parentElement;
    simCanvas.width = wr.clientWidth;
    simCanvas.height = wr.clientHeight;
    const cr = chartCanvas.parentElement;
    chartCanvas.width = cr.clientWidth;
    chartCanvas.height = cr.clientHeight;
}

window.addEventListener('resize', () => {
    resizeCanvases();
});
resizeCanvases();

// ===============================================
//  HILFS-FUNKTIONEN
// ===============================================
const rnd = (a, b) => a + Math.random() * (b - a);
const rndI = (a, b) => Math.floor(rnd(a, b + 1));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function mutate(val, base, range, rate) {
    if (Math.random() < rate) {
        return clamp(val + rnd(-range, range), base * 0.2, base * 3);
    }
    return val;
}

// ===============================================
//  GENE & CREATURE
// ===============================================
function makeGenes(base) {
    const spread = 0.3;
    return {
        speed: clamp(rnd(base.speed * (1 - spread), base.speed * (1 + spread)), 0.3, 6),
        sight: clamp(rnd(base.sight * (1 - spread), base.sight * (1 + spread)), 15, 250),
        size: clamp(rnd(base.size * (1 - spread), base.size * (1 + spread)), 3, 25),
    };
}

function inheritGenes(g1, g2, mutRate) {
    const ng = {};
    for (const k of ['speed', 'sight', 'size']) {
        ng[k] = Math.random() < 0.5 ? g1[k] : g2[k];
    }
    // Mutieren
    ng.speed = mutate(ng.speed, P.gSpeed, 0.4, mutRate);
    ng.sight = mutate(ng.sight, P.gSight, 12, mutRate);
    ng.size = mutate(ng.size, P.gSize, 1.5, mutRate);
    return ng;
}

function geneColor(g) {
    // Farbe: schnell=gruen, langsam=blau, gross=warm
    const sr = clamp((g.speed - 0.5) / 5, 0, 1);
    const sz = clamp((g.size - 3) / 22, 0, 1);
    const h = 120 - sr * 80 + sz * 40;
    const s = 70 + sz * 20;
    const l = 50 + sr * 15;
    return `hsl(${h},${s}%,${l}%)`;
}

function spawnCreature(x, y, genes, gen) {
    return {
        x,
        y,
        vx: rnd(-1, 1),
        vy: rnd(-1, 1),
        genes,
        energy: 100,
        age: 0,
        gen,
        color: geneColor(genes),
        target: null,
        poisoned: false,
        poisonTimer: 0,
        reproTimer: rndI(200, 400),
        id: Math.random(),
        shape: Math.random() < 0.5 ? 'circle' : 'tri',
    };
}

function spawnFood(x, y) {
    return {
        x,
        y,
        r: rnd(2.5, 5),
        energy: rnd(15, 35),
        poisoned: false
    };
}

function spawnPredator(x, y) {
    return {
        x,
        y,
        vx: rnd(-2, 2),
        vy: rnd(-2, 2),
        size: 14,
        speed: 2.5,
        target: null,
        life: 800,
        color: '#ff3a5c',
    };
}

// ===============================================
//  INIT
// ===============================================
function init() {
    tick = 0;
    generation = 0;
    totalDead = 0;
    totalBorn = 0;
    creatures = [];
    foods = [];
    predators = [];
    poisonZones = [];
    activeEvent = null;
    eventTimer = 0;
    trendHistory.speed = [];
    trendHistory.sight = [];
    trendHistory.size = [];

    const W = simCanvas.width,
        H = simCanvas.height;
    const baseGenes = {
        speed: P.gSpeed,
        sight: P.gSight,
        size: P.gSize
    };

    for (let i = 0; i < P.creatureCount; i++) {
        creatures.push(spawnCreature(rnd(30, W - 30), rnd(30, H - 30), makeGenes(baseGenes), 0));
    }
    for (let i = 0; i < P.foodCount; i++) {
        foods.push(spawnFood(rnd(10, W - 10), rnd(10, H - 10)));
    }

    logEvent('Simulation gestartet', 'accent');
}

// ===============================================
//  UPDATES
// ===============================================

function updateFood(W, H) {
    // Nahrung nachspawnen
    const target = activeEvent === 'drought' ? Math.floor(P.foodCount * 0.25) :
        activeEvent === 'foodburst' ? P.foodCount * 2 :
        P.foodCount;
    if (foods.length < target && Math.random() < 0.08) {
        foods.push(spawnFood(rnd(10, W - 10), rnd(10, H - 10)));
    }
}

function updateCreatures(W, H) {
    const mutRate = activeEvent === 'mutwave' ? Math.min(P.mutation * 4, 0.6) : P.mutation;
    const newBorn = [];

    for (let i = creatures.length - 1; i >= 0; i--) {
        const c = creatures[i];
        c.age++;

        // Gift
        if (c.poisoned) {
            c.poisonTimer--;
            c.energy -= 0.4;
            if (c.poisonTimer <= 0) c.poisoned = false;
        }

        // Energie durch Groesse
        const sizeCost = (c.genes.size / P.gSize) * 0.03;
        const speedCost = (c.genes.speed / P.gSpeed) * 0.02;
        c.energy -= sizeCost + speedCost + 0.01;

        // Duerre: extra Energieverlust
        if (activeEvent === 'drought') c.energy -= 0.05;

        // Tod
        if (c.energy <= 0 || c.age > 3000) {
            creatures.splice(i, 1);
            totalDead++;
            continue;
        }

        // Nahrung suchen (in Sehweite)
        let bestFood = null,
            bestDist = c.genes.sight;
        for (const f of foods) {
            const d = dist(c, f);
            if (d < bestDist) {
                bestDist = d;
                bestFood = f;
            }
        }

        if (bestFood) {
            // Auf Nahrung zubewegen
            const angle = Math.atan2(bestFood.y - c.y, bestFood.x - c.x);
            c.vx += Math.cos(angle) * 0.4;
            c.vy += Math.sin(angle) * 0.4;
        } else {
            // Zufallsbewegung
            c.vx += rnd(-0.3, 0.3);
            c.vy += rnd(-0.3, 0.3);
        }

        // Raeuber ausweichen
        for (const pr of predators) {
            const d = dist(c, pr);
            if (d < c.genes.sight * 0.6) {
                const angle = Math.atan2(c.y - pr.y, c.x - pr.x);
                c.vx += Math.cos(angle) * 1.5;
                c.vy += Math.sin(angle) * 1.5;
            }
        }

        // Geschwindigkeit begrenzen
        const spd = c.genes.speed * P.speed;
        const mag = Math.hypot(c.vx, c.vy);
        if (mag > spd) {
            c.vx = (c.vx / mag) * spd;
            c.vy = (c.vy / mag) * spd;
        }

        // Bewegen
        c.x = clamp(c.x + c.vx, c.genes.size, W - c.genes.size);
        c.y = clamp(c.y + c.vy, c.genes.size, H - c.genes.size);
        if (c.x <= c.genes.size || c.x >= W - c.genes.size) c.vx *= -1;
        if (c.y <= c.genes.size || c.y >= H - c.genes.size) c.vy *= -1;

        // Fressen
        for (let j = foods.length - 1; j >= 0; j--) {
            const f = foods[j];
            if (dist(c, f) < c.genes.size + f.r) {
                if (f.poisoned) {
                    c.poisoned = true;
                    c.poisonTimer = 120;
                } else c.energy = Math.min(c.energy + f.energy, 150);
                foods.splice(j, 1);
                break;
            }
        }

        // Giftzone
        for (const pz of poisonZones) {
            if (dist(c, pz) < pz.r) {
                c.poisoned = true;
                c.poisonTimer = 200;
            }
        }

        // Fortpflanzung
        c.reproTimer--;
        if (c.reproTimer <= 0 && c.energy > 80 && creatures.length < 300) {
            c.reproTimer = rndI(250, 500);
            c.energy -= 35;
            // Partner suchen
            let partner = null;
            for (const other of creatures) {
                if (other !== c && dist(c, other) < 40 && other.energy > 60) {
                    partner = other;
                    break;
                }
            }
            const parentGenes2 = partner ? partner.genes : c.genes;
            const childGenes = inheritGenes(c.genes, parentGenes2, mutRate);
            const child = spawnCreature(
                c.x + rnd(-15, 15), c.y + rnd(-15, 15),
                childGenes,
                Math.max(c.gen, partner ? partner.gen : 0) + 1
            );
            newBorn.push(child);
            totalBorn++;
            generation = Math.max(generation, child.gen);
        }
    }

    creatures.push(...newBorn);
}

function updatePredators(W, H) {
    for (let i = predators.length - 1; i >= 0; i--) {
        const pr = predators[i];
        pr.life--;
        if (pr.life <= 0) {
            predators.splice(i, 1);
            continue;
        }

        // Ziel finden
        let best = null,
            bd = 180;
        for (const c of creatures) {
            const d = dist(pr, c);
            if (d < bd) {
                bd = d;
                best = c;
            }
        }
        pr.target = best;

        if (best) {
            const angle = Math.atan2(best.y - pr.y, best.x - pr.x);
            pr.vx += Math.cos(angle) * 0.6;
            pr.vy += Math.sin(angle) * 0.6;
        } else {
            pr.vx += rnd(-0.4, 0.4);
            pr.vy += rnd(-0.4, 0.4);
        }

        const mag = Math.hypot(pr.vx, pr.vy);
        if (mag > pr.speed) {
            pr.vx = (pr.vx / mag) * pr.speed;
            pr.vy = (pr.vy / mag) * pr.speed;
        }

        pr.x = clamp(pr.x + pr.vx, 0, W);
        pr.y = clamp(pr.y + pr.vy, 0, H);

        // Kreatur fressen
        for (let j = creatures.length - 1; j >= 0; j--) {
            const c = creatures[j];
            if (dist(pr, c) < pr.size + c.genes.size * 0.6) {
                creatures.splice(j, 1);
                totalDead++;
                pr.life += 150;
                break;
            }
        }
    }
}

function updatePoisonZones() {
    for (let i = poisonZones.length - 1; i >= 0; i--) {
        poisonZones[i].life--;
        if (poisonZones[i].life <= 0) poisonZones.splice(i, 1);
    }
}

function updateEvent() {
    if (activeEvent && eventTimer > 0) {
        eventTimer--;
        if (eventTimer <= 0) {
            logEvent(`Ereignis "${activeEvent}" endet`, 'accent');
            activeEvent = null;
            document.getElementById('eventBadge').style.display = 'none';
            document.getElementById('canvasWrapper').className = '';
        }
    }
}

function recordTrend() {
    if (creatures.length === 0) return;
    const n = creatures.length;
    const avgSpeed = creatures.reduce((s, c) => s + c.genes.speed, 0) / n;
    const avgSight = creatures.reduce((s, c) => s + c.genes.sight, 0) / n;
    const avgSize = creatures.reduce((s, c) => s + c.genes.size, 0) / n;
    trendHistory.speed.push(avgSpeed);
    trendHistory.sight.push(avgSight / 50); // normieren
    trendHistory.size.push(avgSize / 10);
    if (trendHistory.speed.length > MAX_HISTORY) {
        trendHistory.speed.shift();
        trendHistory.sight.shift();
        trendHistory.size.shift();
    }
}

// ===============================================
//  DRAW
// ===============================================

function drawBg() {
    const W = simCanvas.width,
        H = simCanvas.height;
    ctx.clearRect(0, 0, W, H);
    // Subtiles Grid
    ctx.strokeStyle = '#0f1419';
    ctx.lineWidth = 1;
    const gs = 40;
    for (let x = 0; x < W; x += gs) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
    }
    for (let y = 0; y < H; y += gs) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
    }
}

function drawFood() {
    for (const f of foods) {
        if (f.poisoned) {
            ctx.fillStyle = '#7c5cfc88';
            ctx.shadowColor = '#7c5cfc';
            ctx.shadowBlur = 6;
        } else {
            ctx.fillStyle = '#00e5a0cc';
            ctx.shadowColor = '#00e5a0';
            ctx.shadowBlur = 4;
        }
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
    }
}

function drawPoisonZones() {
    for (const pz of poisonZones) {
        const alpha = clamp(pz.life / 300, 0, 0.35);
        ctx.fillStyle = `rgba(124,92,252,${alpha})`;
        ctx.beginPath();
        ctx.arc(pz.x, pz.y, pz.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(124,92,252,${alpha * 2})`;
        ctx.lineWidth = 1;
        ctx.stroke();
    }
}

function drawCreature(c) {
    const r = c.genes.size;
    ctx.save();
    ctx.translate(c.x, c.y);

    // Sehweite anzeigen (sehr schwach)
    if (hoveredCreature === c) {
        ctx.beginPath();
        ctx.arc(0, 0, c.genes.sight, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    // Poisoned glow
    if (c.poisoned) {
        ctx.shadowColor = '#7c5cfc';
        ctx.shadowBlur = 10;
    } else {
        ctx.shadowColor = c.color;
        ctx.shadowBlur = 4;
    }

    ctx.fillStyle = c.poisoned ? '#9070ff' : c.color;

    if (c.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        // Kern
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.beginPath();
        ctx.arc(-r * 0.2, -r * 0.2, r * 0.35, 0, Math.PI * 2);
        ctx.fill();
    } else {
        // Dreieck
        const angle = Math.atan2(c.vy, c.vx);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(r * 1.3, 0);
        ctx.lineTo(-r, r * 0.8);
        ctx.lineTo(-r * 0.5, 0);
        ctx.lineTo(-r, -r * 0.8);
        ctx.closePath();
        ctx.fill();
    }

    ctx.shadowBlur = 0;
    ctx.restore();
}

function drawPredators() {
    for (const pr of predators) {
        ctx.save();
        ctx.translate(pr.x, pr.y);
        ctx.shadowColor = '#ff3a5c';
        ctx.shadowBlur = 15;
        ctx.fillStyle = '#ff3a5c';

        // Stern-aehnliche Form
        const s = pr.size;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            const rr = i % 2 === 0 ? s : s * 0.5;
            i === 0 ? ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr) :
                ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.restore();
    }
}

function drawChart() {
    const W = chartCanvas.width,
        H = chartCanvas.height;
    cctx.clearRect(0, 0, W, H);
    cctx.fillStyle = '#111418';
    cctx.fillRect(0, 0, W, H);

    const keys = ['speed', 'sight', 'size'];
    const colors = ['#00e5a0', '#7c5cfc', '#ff6b35'];
    const labels = ['Geschw.', 'Sicht/50', 'Groesse/10'];

    for (let ki = 0; ki < keys.length; ki++) {
        const data = trendHistory[keys[ki]];
        if (data.length < 2) continue;
        const maxVal = Math.max(...data, 0.1);
        cctx.beginPath();
        cctx.strokeStyle = colors[ki];
        cctx.lineWidth = 1.5;
        cctx.shadowColor = colors[ki];
        cctx.shadowBlur = 4;
        for (let i = 0; i < data.length; i++) {
            const x = (i / MAX_HISTORY) * W;
            const y = H - 10 - (data[i] / (maxVal * 1.1)) * (H - 20);
            i === 0 ? cctx.moveTo(x, y) : cctx.lineTo(x, y);
        }
        cctx.stroke();
        cctx.shadowBlur = 0;

        // Legende
        const lx = 80 + ki * 90;
        cctx.fillStyle = colors[ki];
        cctx.fillRect(lx, 6, 10, 3);
        cctx.font = '9px Space Mono, monospace';
        cctx.fillStyle = '#c8d4e0';
        cctx.fillText(labels[ki], lx + 14, 12);
    }
}

// ===============================================
//  HUD / TOOLTIP
// ===============================================

let hoveredCreature = null;

simCanvas.addEventListener('mousemove', (e) => {
    const rect = simCanvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (simCanvas.width / rect.width);
    const my = (e.clientY - rect.top) * (simCanvas.height / rect.height);

    hoveredCreature = null;
    for (const c of creatures) {
        if (dist(c, {
                x: mx,
                y: my
            }) < c.genes.size + 6) {
            hoveredCreature = c;
            break;
        }
    }

    const tt = document.getElementById('tooltip');
    if (hoveredCreature) {
        const g = hoveredCreature.genes;
        tt.style.display = 'block';
        tt.style.left = (e.clientX - rect.left + 14) + 'px';
        tt.style.top = (e.clientY - rect.top + 14) + 'px';
        tt.innerHTML = `
      <b>${hoveredCreature.shape === 'circle' ? '&#9679; Kreis' : '&#9650; Dreieck'}</b><br>
      Gen: ${hoveredCreature.gen} &nbsp; Alter: ${hoveredCreature.age}<br>
      Energie: ${Math.round(hoveredCreature.energy)}<br>
      Geschw.: ${g.speed.toFixed(2)} &nbsp; Sicht: ${Math.round(g.sight)}<br>
      Groesse: ${g.size.toFixed(1)}<br>
      ${hoveredCreature.poisoned ? '&#9760; vergiftet' : ''}
    `;
    } else {
        tt.style.display = 'none';
    }
});

simCanvas.addEventListener('click', (e) => {
    // Giftzone platzieren bei Rechtsklick -- hier Doppelklick
});

function updateHUD() {
    if (creatures.length === 0) return;
    const n = creatures.length;
    const avgSpeed = (creatures.reduce((s, c) => s + c.genes.speed, 0) / n).toFixed(2);
    const avgSight = Math.round(creatures.reduce((s, c) => s + c.genes.sight, 0) / n);
    const avgSize = (creatures.reduce((s, c) => s + c.genes.size, 0) / n).toFixed(1);

    document.getElementById('statPop').textContent = n;
    document.getElementById('statGen').textContent = generation;
    document.getElementById('statSpeed').textContent = avgSpeed;
    document.getElementById('statSight').textContent = avgSight;
    document.getElementById('statSize').textContent = avgSize;
    document.getElementById('statFood').textContent = foods.length;

    document.getElementById('tbAlive').textContent = n;
    document.getElementById('tbDead').textContent = totalDead;
    document.getElementById('tbBorn').textContent = totalBorn;
    document.getElementById('tbGen').textContent = generation;
    document.getElementById('tbTick').textContent = tick;
    document.getElementById('genNum').textContent = generation;
}

// ===============================================
//  HAUPT-LOOP
// ===============================================

let lastTrend = 0;

function loop() {
    if (!running) return;

    const steps = P.speed;
    const W = simCanvas.width,
        H = simCanvas.height;

    for (let s = 0; s < steps; s++) {
        tick++;
        updateFood(W, H);
        updateCreatures(W, H);
        updatePredators(W, H);
        updatePoisonZones();
        updateEvent();

        if (creatures.length === 0) {
            logEvent('Warnung: Alle Lebewesen gestorben!', 'danger');
            running = false;
            break;
        }
    }

    // Gentrend aufzeichnen (alle 30 Frames)
    if (tick - lastTrend > 30) {
        recordTrend();
        lastTrend = tick;
    }

    // Zeichnen
    drawBg();
    drawPoisonZones();
    drawFood();
    for (const c of creatures) drawCreature(c);
    drawPredators();
    drawChart();
    updateHUD();

    animFrame = requestAnimationFrame(loop);
}

// ===============================================
//  EVENT LOG
// ===============================================

function logEvent(msg, cls = '') {
    const log = document.getElementById('eventLog');
    const el = document.createElement('div');
    el.className = 'log-entry' + (cls ? ' ' + cls : '');
    const t = String(tick).padStart(5, '0');
    el.textContent = `[${t}] ${msg}`;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    // Max 60 Eintraege
    while (log.children.length > 61) log.removeChild(log.children[1]);
}

function showEventBadge(text, color) {
    const b = document.getElementById('eventBadge');
    b.textContent = text;
    b.style.background = color;
    b.style.boxShadow = `0 0 20px ${color}`;
    b.style.display = 'block';
}

// ===============================================
//  SLIDER BINDINGS
// ===============================================

function bindSlider(id, valId, param, fmt) {
    const sl = document.getElementById(id);
    const vl = document.getElementById(valId);
    sl.addEventListener('input', () => {
        const v = parseFloat(sl.value);
        P[param] = fmt(v);
        vl.textContent = fmt(v);
    });
}

document.getElementById('sCreatures').addEventListener('input', function() {
    P.creatureCount = parseInt(this.value);
    document.getElementById('vCreatures').textContent = P.creatureCount;
});
document.getElementById('sFood').addEventListener('input', function() {
    P.foodCount = parseInt(this.value);
    document.getElementById('vFood').textContent = P.foodCount;
});
document.getElementById('sSpeed').addEventListener('input', function() {
    P.speed = parseInt(this.value);
    document.getElementById('vSpeed').textContent = P.speed + 'x';
});
document.getElementById('sMutation').addEventListener('input', function() {
    P.mutation = parseFloat(this.value) / 100;
    document.getElementById('vMutation').textContent = P.mutation.toFixed(2);
});
document.getElementById('sGSpeed').addEventListener('input', function() {
    P.gSpeed = parseFloat(this.value) / 10;
    document.getElementById('vGSpeed').textContent = P.gSpeed.toFixed(1);
});
document.getElementById('sGSight').addEventListener('input', function() {
    P.gSight = parseInt(this.value);
    document.getElementById('vGSight').textContent = P.gSight;
});
document.getElementById('sGSize').addEventListener('input', function() {
    P.gSize = parseInt(this.value);
    document.getElementById('vGSize').textContent = P.gSize;
});

// ===============================================
//  BUTTONS
// ===============================================

document.getElementById('btnStart').addEventListener('click', () => {
    if (!running) {
        running = true;
        if (creatures.length === 0) init();
        logEvent('Simulation laeuft', 'accent');
        loop();
    }
});

document.getElementById('btnStop').addEventListener('click', () => {
    running = false;
    if (animFrame) cancelAnimationFrame(animFrame);
    logEvent('Simulation pausiert');
});

document.getElementById('btnRestart').addEventListener('click', () => {
    running = false;
    if (animFrame) cancelAnimationFrame(animFrame);
    init();
    running = true;
    loop();
});

document.getElementById('btnRandom').addEventListener('click', () => {
    // Zufaellige Parameter
    P.creatureCount = rndI(15, 100);
    P.foodCount = rndI(30, 200);
    P.mutation = rnd(0.01, 0.3);
    P.gSpeed = rnd(0.5, 4.0);
    P.gSight = rndI(30, 180);
    P.gSize = rndI(4, 18);

    // Slider & Werte aktualisieren
    document.getElementById('sCreatures').value = P.creatureCount;
    document.getElementById('vCreatures').textContent = P.creatureCount;
    document.getElementById('sFood').value = P.foodCount;
    document.getElementById('vFood').textContent = P.foodCount;
    document.getElementById('sMutation').value = Math.round(P.mutation * 100);
    document.getElementById('vMutation').textContent = P.mutation.toFixed(2);
    document.getElementById('sGSpeed').value = Math.round(P.gSpeed * 10);
    document.getElementById('vGSpeed').textContent = P.gSpeed.toFixed(1);
    document.getElementById('sGSight').value = P.gSight;
    document.getElementById('vGSight').textContent = P.gSight;
    document.getElementById('sGSize').value = P.gSize;
    document.getElementById('vGSize').textContent = P.gSize;

    logEvent('Zufaellige Parameter gesetzt', 'accent');

    running = false;
    if (animFrame) cancelAnimationFrame(animFrame);
    init();
    running = true;
    loop();
});

// Ereignisse
document.getElementById('btnDrought').addEventListener('click', () => {
    activeEvent = 'drought';
    eventTimer = 800;
    showEventBadge('DUERRE AKTIV', '#ff6b35');
    document.getElementById('canvasWrapper').className = 'drought';
    // Nahrung stark reduzieren
    foods = foods.slice(0, Math.floor(foods.length * 0.3));
    logEvent('Duerre ausgebrochen! Nahrung schwindet...', 'warn');
});

document.getElementById('btnPlague').addEventListener('click', () => {
    activeEvent = 'plague';
    eventTimer = 500;
    showEventBadge('SEUCHE AKTIV', '#ff3a5c');
    document.getElementById('canvasWrapper').className = 'plague';
    // Viele Kreaturen vergiften
    let cnt = 0;
    for (const c of creatures) {
        if (Math.random() < 0.5) {
            c.poisoned = true;
            c.poisonTimer = 400;
            cnt++;
        }
    }
    logEvent(`Seuche! ${cnt} Lebewesen infiziert`, 'danger');
});

document.getElementById('btnMutWave').addEventListener('click', () => {
    activeEvent = 'mutwave';
    eventTimer = 600;
    showEventBadge('MUTATIONSWELLE', '#7c5cfc');
    logEvent('Stark erhoehte Mutationsrate!', 'purple');
});

document.getElementById('btnFoodBurst').addEventListener('click', () => {
    const W = simCanvas.width,
        H = simCanvas.height;
    const extra = Math.round(P.foodCount * 1.5);
    for (let i = 0; i < extra; i++) foods.push(spawnFood(rnd(10, W - 10), rnd(10, H - 10)));
    logEvent(`Nahrungsschub! +${extra} Nahrung`, 'accent');
});

document.getElementById('btnPoison').addEventListener('click', () => {
    const W = simCanvas.width,
        H = simCanvas.height;
    // 3 Giftzonen platzieren
    for (let i = 0; i < 3; i++) {
        poisonZones.push({
            x: rnd(60, W - 60),
            y: rnd(60, H - 60),
            r: rnd(40, 90),
            life: 400
        });
    }
    // Einige Nahrungseinheiten vergiften
    let cnt = 0;
    for (const f of foods) {
        if (Math.random() < 0.25) {
            f.poisoned = true;
            cnt++;
        }
    }
    logEvent(`Gift versprueht! ${cnt} Nahrung verseucht.`, 'purple');
});

document.getElementById('btnPredator').addEventListener('click', () => {
    const W = simCanvas.width,
        H = simCanvas.height;
    for (let i = 0; i < 3; i++) {
        predators.push(spawnPredator(rnd(20, W - 20), rnd(20, H - 20)));
    }
    logEvent('3 Raeuber erscheinen!', 'danger');
});

// ===============================================
//  START
// ===============================================
init();
// Nicht automatisch starten -- Nutzer drueckt Start
// Aber einmalig zeichnen
drawBg();
drawFood();
for (const c of creatures) drawCreature(c);
drawChart();
updateHUD();
logEvent('Bereit. Druecke START zum Beginnen.', 'accent');