'use strict';
/* Sound Lab UI — lazy-loaded only when the menu is opened. Persistence and
   playback live in audio.js so saved choices already apply in fights. */

import {
  SOUND_CATEGORIES,
  SOUND_LAB_MAX_BYTES,
  listSoundSlots,
  listBundledSounds,
  playSlotPreview,
  playBundledPreview,
  setSlotBundled,
  setSlotCustom,
  resetSlot,
  resetAllSlots,
  unlockAudio,
} from './audio.js';

const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const ACCEPT = 'audio/mpeg,audio/wav,audio/wave,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,.mp3,.wav,.m4a,audio/*';

export function mount(root) {
  if (!root) return;
  unlockAudio();
  root.innerHTML = `
    <div class="rfs-card rfs-soundlab-card">
      <header class="rfs-selhead">
        <small>Audio</small>
        <b>Sound Lab</b>
      </header>
      <p class="rfs-sub">Preview any slot, swap it for another bundled sound, or use a file from this device (mp3, wav, or m4a, up to 5 MB). Changes stay on this device and apply in fights right away.</p>
      <div class="rfs-row rfs-sl-top">
        <button type="button" class="rfs-f rfs-btn rfs-small" data-sl="reset-all">Reset all</button>
        <button type="button" class="rfs-f rfs-btn rfs-go rfs-small" data-act="back" data-autofocus>Back</button>
      </div>
      <div class="rfs-sl-list"></div>
      <div class="rfs-sl-sheet" hidden></div>
    </div>`;
  const listEl = root.querySelector('.rfs-sl-list');
  const sheetEl = root.querySelector('.rfs-sl-sheet');

  function renderList() {
    const groups = listSoundSlots();
    listEl.innerHTML = groups.map((g) => `
      <section class="rfs-sl-cat" data-cat="${esc(g.id)}">
        <h3>${esc(g.label)}</h3>
        ${g.slots.map((s) => `
          <div class="rfs-sl-row${s.isDefault ? '' : ' is-custom'}" data-slot="${esc(s.id)}">
            <div class="rfs-sl-meta">
              <b>${esc(s.label)}</b>
              <small>${esc(s.current)}</small>
            </div>
            <div class="rfs-sl-actions">
              <button type="button" class="rfs-f rfs-btn rfs-small" data-sl="play" data-slot="${esc(s.id)}">Play</button>
              <button type="button" class="rfs-f rfs-btn rfs-small" data-sl="change" data-slot="${esc(s.id)}">Change</button>
              <button type="button" class="rfs-f rfs-btn rfs-small" data-sl="reset" data-slot="${esc(s.id)}" ${s.isDefault ? 'disabled' : ''}>Reset</button>
            </div>
          </div>`).join('')}
      </section>`).join('');
  }

  function closeSheet() {
    sheetEl.hidden = true;
    sheetEl.innerHTML = '';
  }

  function openSheet(slotId) {
    const groups = listSoundSlots();
    let slot = null;
    for (const g of groups) {
      slot = g.slots.find((s) => s.id === slotId) || slot;
    }
    if (!slot) return;
    const bundled = listBundledSounds();
    sheetEl.hidden = false;
    sheetEl.innerHTML = `
      <div class="rfs-sl-sheet-inner" role="dialog" aria-label="Choose a sound">
        <header class="rfs-selhead">
          <small>Replace</small>
          <b>${esc(slot.label)}</b>
        </header>
        <p class="rfs-note">Pick a bundled sound or use a file from this device.</p>
        <label class="rfs-f rfs-btn rfs-sl-upload">
          Use a file from this device
          <input type="file" accept="${ACCEPT}" class="rfs-sl-file">
        </label>
        <p class="rfs-sl-err" hidden></p>
        <div class="rfs-sl-pick-list">
          ${SOUND_CATEGORIES.map((cat) => {
            const items = bundled.filter((s) => s.category === cat.id);
            if (!items.length) return '';
            return `<section class="rfs-sl-cat">
              <h3>${esc(cat.label)}</h3>
              ${items.map((s) => `
                <div class="rfs-sl-row">
                  <div class="rfs-sl-meta"><b>${esc(s.label)}</b></div>
                  <div class="rfs-sl-actions">
                    <button type="button" class="rfs-f rfs-btn rfs-small" data-sl="preview-file" data-file="${esc(s.file)}">Play</button>
                    <button type="button" class="rfs-f rfs-btn rfs-small rfs-go" data-sl="use-file" data-file="${esc(s.file)}" data-slot="${esc(slotId)}">Use</button>
                  </div>
                </div>`).join('')}
            </section>`;
          }).join('')}
        </div>
        <div class="rfs-row"><button type="button" class="rfs-f rfs-btn rfs-small" data-sl="close-sheet">Close</button></div>
      </div>`;
    const fileInput = sheetEl.querySelector('.rfs-sl-file');
    const errEl = sheetEl.querySelector('.rfs-sl-err');
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      errEl.hidden = true;
      if (file.size > SOUND_LAB_MAX_BYTES) {
        errEl.hidden = false;
        errEl.textContent = 'That file is over 5 MB. Please pick a smaller one.';
        return;
      }
      try {
        unlockAudio();
        await setSlotCustom(slotId, file);
        closeSheet();
        renderList();
      } catch (err) {
        errEl.hidden = false;
        errEl.textContent = (err && err.message) ? err.message : 'Could not read that audio file.';
      }
    });
  }

  root.onclick = async (e) => {
    const b = e.target.closest('[data-sl]');
    if (!b || !root.contains(b)) return;
    const act = b.dataset.sl;
    const id = b.dataset.slot;
    if (act === 'play' && id) {
      e.stopPropagation();
      unlockAudio();
      playSlotPreview(id);
      return;
    }
    if (act === 'change' && id) {
      e.stopPropagation();
      unlockAudio();
      openSheet(id);
      return;
    }
    if (act === 'reset' && id) {
      e.stopPropagation();
      await resetSlot(id);
      renderList();
      return;
    }
    if (act === 'reset-all') {
      e.stopPropagation();
      await resetAllSlots();
      closeSheet();
      renderList();
      return;
    }
    if (act === 'close-sheet') {
      e.stopPropagation();
      closeSheet();
      return;
    }
    if (act === 'preview-file' && b.dataset.file) {
      e.stopPropagation();
      unlockAudio();
      playBundledPreview(b.dataset.file);
      return;
    }
    if (act === 'use-file' && b.dataset.file && id) {
      e.stopPropagation();
      setSlotBundled(id, b.dataset.file);
      closeSheet();
      renderList();
    }
  };

  renderList();
}
