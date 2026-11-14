// The DOM HUD: crosshair, hit marker, health, ammo, money, timer, score,
// team pips, killfeed, bomb banner, buy menu, round banners and a live
// minimap. It never touches the simulation; main.js pushes numbers in and
// reads the buy and play callbacks out. DOM writes are cached so a value that
// did not change costs no layout. `persistent` keeps banners, the killfeed
// and the hit marker on screen: staged captures (?shot=) fast-forward the
// clock, which would otherwise expire them before the screenshot lands.
export function createHud(persistent = false) {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const healthFill = $('health-fill');
  const healthValue = $('health-value');
  const armourValue = $('armour-value');
  const moneyValue = $('money-value');
  const timerValue = $('timer-value');
  const scoreEmber = $('score-ember');
  const scoreAsh = $('score-ash');
  const roundValue = $('round-value');
  const pipsEmber = $('pips-ember');
  const pipsAsh = $('pips-ash');
  const killfeed = $('killfeed');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const bombBanner = $('bomb-banner');
  const buyMenu = $('buy-menu');
  const buyList = $('buy-list');
  const buyMoney = $('buy-money');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const damageFlash = $('damage-flash');
  const minimap = $('minimap');
  const mapCtx = minimap ? minimap.getContext('2d') : null;

  const COPY = {
    start: {
      title: 'Ember Yard',
      copy: 'Round-based tactical FPS. Plant the charge at Site A or Site B — or eliminate the Ash team. Buy between rounds. Click to play.',
      action: 'Click to play',
    },
    paused: { title: 'Ember Yard', copy: 'Paused. Click to resume.', action: 'Click to resume' },
    dead: { title: 'You were eliminated', copy: 'Spectating your team. The round plays on.', action: 'Keep watching' },
    end: { title: 'Match over', copy: '', action: 'Play again' },
  };

  let last = {};
  let hitTimer = 0;
  let bannerTimer = 0;

  function setText(node, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    node.textContent = value;
  }

  return {
    setHealth(hp, armour) {
      setText(healthValue, 'hp', String(Math.max(0, Math.ceil(hp))));
      setText(armourValue, 'armour', armour > 0 ? `+${Math.ceil(armour)}` : '');
      const pct = Math.max(0, Math.min(100, hp));
      if (last.hppct !== pct) {
        last.hppct = pct;
        healthFill.style.width = `${pct}%`;
        healthFill.classList.toggle('low', pct <= 30);
      }
    },
    setAmmo(mag, reserve, name, grenades) {
      setText(ammoMag, 'mag', String(mag));
      setText(ammoReserve, 'reserve', `/ ${reserve}`);
      setText(weaponName, 'weapon', `${name}${grenades > 0 ? ` · ${grenades} frag` : ''}`);
      $('ammo').classList.toggle('empty', mag === 0);
    },
    setMoney(value) {
      setText(moneyValue, 'money', `$${value.toLocaleString('en-US')}`);
    },
    setTimer(seconds, planted, urgentAllowed = true) {
      const s = Math.max(0, Math.ceil(seconds));
      const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      setText(timerValue, 'timer', text);
      timerValue.classList.toggle('urgent', urgentAllowed && (s <= 10 || planted));
    },
    setScore(ember, ash, round) {
      setText(scoreEmber, 'se', String(ember));
      setText(scoreAsh, 'sa', String(ash));
      setText(roundValue, 'round', `Round ${round}`);
    },
    setAlive(emberAlive, ashAlive) {
      const key = `${emberAlive}-${ashAlive}`;
      if (last.alive === key) return;
      last.alive = key;
      pipsEmber.innerHTML = '';
      pipsAsh.innerHTML = '';
      for (let i = 0; i < 4; i += 1) {
        const e = document.createElement('i');
        e.className = i < emberAlive ? 'on' : 'off';
        pipsEmber.appendChild(e);
        const a = document.createElement('i');
        a.className = i < ashAlive ? 'on' : 'off';
        pipsAsh.appendChild(a);
      }
    },
    setBomb(state, seconds) {
      // state: 'none' | 'planting' | 'planted' | 'defusing' | 'defused'
      if (last.bomb === state) return;
      last.bomb = state;
      bombBanner.hidden = state === 'none';
      if (state === 'planted') {
        bombBanner.textContent = `CHARGE PLANTED — ${Math.ceil(seconds)}s`;
        bombBanner.className = 'planted';
      } else if (state === 'planting') {
        bombBanner.textContent = 'PLANTING CHARGE…';
        bombBanner.className = 'planting';
      } else if (state === 'defusing') {
        bombBanner.textContent = 'DEFUSING…';
        bombBanner.className = 'defusing';
      } else if (state === 'defused') {
        bombBanner.textContent = 'CHARGE DEFUSED';
        bombBanner.className = 'defused';
      }
    },
    setBombTime(seconds) {
      if (last.bomb !== 'planted') return;
      bombBanner.textContent = `CHARGE PLANTED — ${Math.ceil(seconds)}s`;
    },
    killfeed(killer, victim, headshot, killerTeam) {
      const row = document.createElement('div');
      row.className = 'feed-row';
      const k = document.createElement('span');
      k.className = killerTeam === 'ember' ? 'ember' : 'ash';
      k.textContent = killer;
      const mid = document.createElement('span');
      mid.className = 'feed-mid';
      mid.textContent = headshot ? ' ⌖ ' : ' ✕ ';
      const v = document.createElement('span');
      v.textContent = victim;
      row.append(k, mid, v);
      killfeed.prepend(row);
      while (killfeed.children.length > 5) killfeed.lastChild.remove();
      if (!persistent) setTimeout(() => row.remove(), 6000);
    },
    banner(text, sub, holdMs = 2200) {
      bannerTitle.textContent = text;
      bannerSub.textContent = sub ?? '';
      banner.hidden = false;
      if (persistent) return;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => {
        banner.hidden = true;
      }, holdMs);
    },
    hideBanner() {
      banner.hidden = true;
      clearTimeout(bannerTimer);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.style.transform = killed ? 'translate(-50%, -50%) rotate(45deg) scale(1.3)' : '';
      if (persistent) return;
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        hitmarker.classList.remove('on');
        hitmarker.style.transform = '';
      }, holdMs);
    },
    damage() {
      damageFlash.classList.add('on');
      setTimeout(() => damageFlash.classList.remove('on'), 180);
    },
    setSpread(px) {
      crosshair.style.setProperty('--gap', `${px}px`);
    },
    showBuy(items, money, onBuy) {
      buyMoney.textContent = `$${money.toLocaleString('en-US')}`;
      buyList.innerHTML = '';
      items.forEach((item, index) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'buy-row';
        row.disabled = item.owned || money < item.price;
        row.innerHTML = `<b>${index + 1} · ${item.name}</b><span>${item.detail}</span><em>$${item.price.toLocaleString('en-US')}</em>`;
        if (item.owned) row.querySelector('em').textContent = 'OWNED';
        row.addEventListener('click', () => onBuy(item));
        buyList.appendChild(row);
      });
      buyMenu.hidden = false;
    },
    hideBuy() {
      buyMenu.hidden = true;
    },
    buyOpen() {
      return !buyMenu.hidden;
    },
    showOverlay(mode, detail) {
      const text = COPY[mode];
      title.textContent = text.title;
      copy.textContent = mode === 'end' ? `${text.copy} ${detail ?? ''}` : text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
    // Minimap: yard bounds x -22..22, z -18..18 mapped onto the canvas.
    // Allies and the player always show; enemies show only while recently seen.
    drawMinimap(player, allies, enemies, sites) {
      if (!mapCtx) return;
      const w = minimap.width;
      const h = minimap.height;
      const px = (x) => ((x + 22) / 44) * w;
      const pz = (z) => ((z + 18) / 36) * h;
      mapCtx.clearRect(0, 0, w, h);
      mapCtx.fillStyle = 'rgba(22,26,32,0.82)';
      mapCtx.fillRect(0, 0, w, h);
      mapCtx.strokeStyle = '#313a44';
      mapCtx.strokeRect(1, 1, w - 2, h - 2);
      for (const site of sites) {
        mapCtx.beginPath();
        mapCtx.arc(px(site.x), pz(site.z), 9, 0, Math.PI * 2);
        mapCtx.strokeStyle = '#f0a830';
        mapCtx.stroke();
        mapCtx.fillStyle = '#f0a830';
        mapCtx.font = 'bold 11px system-ui, sans-serif';
        mapCtx.fillText(site.id, px(site.x) - 4, pz(site.z) + 4);
      }
      for (const ally of allies) {
        if (!ally.alive) continue;
        mapCtx.beginPath();
        mapCtx.arc(px(ally.position.x), pz(ally.position.z), 3.5, 0, Math.PI * 2);
        mapCtx.fillStyle = '#f0a830';
        mapCtx.fill();
      }
      for (const enemy of enemies) {
        if (!enemy.alive || !enemy.seenRecently) continue;
        mapCtx.beginPath();
        mapCtx.arc(px(enemy.position.x), pz(enemy.position.z), 3.5, 0, Math.PI * 2);
        mapCtx.fillStyle = '#e0533d';
        mapCtx.fill();
      }
      if (player) {
        mapCtx.save();
        mapCtx.translate(px(player.x), pz(player.z));
        mapCtx.rotate(-player.yaw);
        mapCtx.fillStyle = '#ece7db';
        mapCtx.beginPath();
        mapCtx.moveTo(0, -6);
        mapCtx.lineTo(4.5, 5);
        mapCtx.lineTo(-4.5, 5);
        mapCtx.closePath();
        mapCtx.fill();
        mapCtx.restore();
      }
    },
  };
}
