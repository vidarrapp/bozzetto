// References (src/reference/): the Reference tab, the board of pictures, the Beside window and
// the picture Over the view, and where the pictures are kept.
//
// refBoard: the tab stands after Tool and before Render, the View and Edit menus name it, a
//   picture is added from the picker (no capture attribute), by paste (only while the panel is
//   open) and by drop, newest first; the row menu has its five actions; Delete asks first.
// refImport: a picture is scaled to 2048 on its long side, written as JPEG (PNG only with
//   transparency), and the metadata is gone: a JPEG carrying an EXIF GPS block comes out without it.
// refShow: the Beside picture has no title bar, drags by itself (finger, mouse, Pencil), zooms, resizes by its corner and toggles from the tile and View; Over the view: Behind (the
//   backdrop) or a blend mode over the view (Multiply changes the pixels) at an opacity; Mirror and Greyscale change what is drawn
//   in each; the View switch takes the over-the-view picture off.
// refInput: a pen stroke through a picture in any front mode still sculpts and the picture never takes the
//   pointer; the beside window takes input only on itself; Tab hides the Beside window and keeps
//   the over-the-view picture.
// refKeep: pictures come back after a reload when keeping on the device is on, and are gone
//   when it is off; New sculpt starts with none; a library project's are found again by its id.
// refFile: Save file carries them with Include references on and not with it off; opening a
//   file brings its own pictures, and one without them an empty board.
// refNoUpload: Save to library sends the scene alone (the network is watched: no reference
//   bytes, no references block), and a thumbnail has no backdrop in it.
// refPhone: at 390 wide the page loads and a picture can be put in the view without errors.
// Each gets (page, base, t).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openArmature, openSculpt } from './lib.mjs';

const SHOTS = process.env.E2E_SHOTS ?? '';
const shot = async (page, name) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
};

async function openForInput(page, base) {
  await openSculpt(page, base, '&q=low');
  await page.waitForFunction(() => !document.getElementById('overlay'), null, { timeout: 30_000 });
}

/** A PNG as bytes: red on the left, blue on the right, a white bar in the middle (or transparent on the left). */
const png = async (page, w, h, { transparent = false, left = '#d02020', right = '#2040d0' } = {}) =>
  Buffer.from(
    await page.evaluate(
      ([w, h, tr, l, r]) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const x = c.getContext('2d');
        if (!tr) {
          x.fillStyle = l;
          x.fillRect(0, 0, w / 2, h);
        }
        x.fillStyle = r;
        x.fillRect(w / 2, 0, w / 2, h);
        x.fillStyle = '#fff';
        x.fillRect(w / 2 - 20, h / 2 - 60, 40, 120);
        return c.toDataURL('image/png').split(',')[1];
      },
      [w, h, transparent, left, right],
    ),
    'base64',
  );

/** A JPEG with an EXIF APP1 block that holds a GPS IFD and a recognisable description. */
async function exifJpeg(page) {
  const jpeg = Buffer.from(
    await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 320;
      c.height = 240;
      const x = c.getContext('2d');
      x.fillStyle = '#e0b030';
      x.fillRect(0, 0, 320, 240);
      x.fillStyle = '#204080';
      x.fillRect(160, 0, 160, 240);
      return c.toDataURL('image/jpeg', 0.9).split(',')[1];
    }),
    'base64',
  );
  const marker = Buffer.from('SECRET-PLACE-59.3293N-18.0686E\0');
  // TIFF, little endian: IFD0 with ImageDescription (0x010E) and a GPS IFD pointer (0x8825); the GPS IFD has latitude ref.
  const ifd0Entries = 2;
  const ifd0Len = 2 + ifd0Entries * 12 + 4;
  const descOff = 8 + ifd0Len;
  const gpsOff = descOff + marker.length + (marker.length % 2);
  const tiff = Buffer.alloc(gpsOff + 2 + 12 + 4);
  tiff.write('II', 0);
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(ifd0Entries, 8);
  let o = 10;
  tiff.writeUInt16LE(0x010e, o);
  tiff.writeUInt16LE(2, o + 2);
  tiff.writeUInt32LE(marker.length, o + 4);
  tiff.writeUInt32LE(descOff, o + 8);
  o += 12;
  tiff.writeUInt16LE(0x8825, o);
  tiff.writeUInt16LE(4, o + 2);
  tiff.writeUInt32LE(1, o + 4);
  tiff.writeUInt32LE(gpsOff, o + 8);
  o += 12;
  tiff.writeUInt32LE(0, o);
  marker.copy(tiff, descOff);
  tiff.writeUInt16LE(1, gpsOff);
  tiff.writeUInt16LE(0x0001, gpsOff + 2); // GPSLatitudeRef
  tiff.writeUInt16LE(2, gpsOff + 4);
  tiff.writeUInt32LE(2, gpsOff + 6);
  tiff.write('N\0', gpsOff + 10);
  const exif = Buffer.concat([Buffer.from('Exif\0\0'), tiff]);
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(exif.length + 2, 2);
  return { bytes: Buffer.concat([jpeg.subarray(0, 2), app1, exif, jpeg.subarray(2)]), marker: marker.toString('latin1').replace(/\0/g, '') };
}

const addFiles = async (page, files) => {
  const before = await count(page);
  await page.setInputFiles('.ref-file', files);
  await page.waitForFunction((n) => window.__sculpt.reference.board.list().length >= n, before + files.length, { timeout: 15_000 });
  await page.waitForTimeout(150);
};

const count = (page) => page.evaluate(() => window.__sculpt.reference.board.list().length);
const names = (page) => page.evaluate(() => window.__sculpt.reference.board.list().map((i) => i.name));
const board = (page) =>
  page.evaluate(() =>
    window.__sculpt.reference.board.list().map((i) => ({ name: i.name, w: i.width, h: i.height, type: i.blob.type, mirror: i.mirror, grey: i.grey })),
  );

async function openPanel(page, open = true) {
  const now = await page.evaluate(() => !document.querySelector('.panel--reference').classList.contains('panel--collapsed'));
  if (now !== open) await page.evaluate(() => document.querySelector('.panel--reference .panel__handle').click());
  await page.waitForTimeout(120);
}

/** Choose a row-menu action on the nth card (1 is the first, the newest). */
async function cardAction(page, n, cls) {
  await page.locator(`.ref-card:nth-child(${n}) .row-more`).click();
  await page.locator(`.ref-card:nth-child(${n}) .${cls}`).click();
  await page.waitForTimeout(250);
}

const meshSum = (page) =>
  page.evaluate(() => {
    let sum = 0;
    for (const m of window.__sculpt.session.getMeshes()) for (const v of m.getVertices()) sum += v;
    return sum;
  });

/** Where the middle of the active object is on the page, in CSS px. */
const meshCentre = (page) =>
  page.evaluate(() => {
    const { session, viewer } = window.__sculpt;
    const b = session.getMesh().computeWorldBound();
    const [px, py] = session.getCamera().project([(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2]);
    const r = viewer.captureCanvas.getBoundingClientRect();
    const pr = session.getPixelRatio();
    return [r.left + px / pr, r.top + py / pr];
  });

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const isRed = ([r, g, b]) => r > 150 && g < 90 && b < 90;
const isBlue = ([r, g, b]) => b > 150 && r < 100 && g < 130;
const isGrey = ([r, g, b]) => Math.abs(r - g) < 10 && Math.abs(g - b) < 10;

/** The colour the viewer draws at a page point (the backdrop shows through where no model is). */
const sample = (page, x, y) => page.evaluate(([x, y]) => window.__sculpt.viewer.samplePixel(x, y), [x, y]).then(rgb);

const visible = (page, sel) =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    return !!e && !e.hidden && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  }, sel);

/** The names of the pictures in the view, lowest first. */
const inViewNames = (page) => page.evaluate(() => window.__sculpt.reference.board.inView().map((i) => i.name).join(','));

/** A pixel of the first picture element in the view (its own canvas), at a fraction of its width and height. */
const picPixel = (page, fx, fy) =>
  page.evaluate(
    ([fx, fy]) => {
      const c = document.querySelector('.ref-pic canvas');
      if (!c) return null;
      return [...c.getContext('2d').getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data].slice(0, 3);
    },
    [fx, fy],
  );

/** Drag the nth tile to a page point, as a mouse, the Pencil, or a finger that holds first. */
async function dragTile(page, n, to, kind = 'mouse') {
  await openPanel(page);
  const from = await page.evaluate((n) => {
    const r = document.querySelector(`.ref-card:nth-child(${n}) .ref-card__thumb`).getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }, n);
  const lerp = (i, steps) => [from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps];
  if (kind === 'mouse') {
    await page.mouse.move(from[0], from[1]);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(...lerp(i, 10));
    await page.mouse.up();
  } else if (kind === 'pen') {
    const cdp = await page.context().newCDPSession(page);
    const pen = (type, x, y, buttons) =>
      cdp.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1, pointerType: 'pen', force: 0.6 });
    await pen('mouseMoved', from[0], from[1], 0);
    await pen('mousePressed', from[0], from[1], 1);
    for (let i = 1; i <= 10; i++) await pen('mouseMoved', ...lerp(i, 10), 1);
    await pen('mouseReleased', to[0], to[1], 0);
  } else {
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    await touch('touchStart', [{ x: from[0], y: from[1], id: 1 }]);
    if (kind === 'touch-hold') await page.waitForTimeout(450);
    for (let i = 1; i <= 10; i++) {
      const [x, y] = lerp(i, 10);
      await touch('touchMove', [{ x, y, id: 1 }]);
    }
    await touch('touchEnd', []);
  }
  await page.waitForTimeout(400);
}

/** Press one of the buttons in the first picture's row while arranging. */
const frameButton = (page, action) => frameButtonOf(page, null, action);
async function frameButtonOf(page, name, action) {
  await page.evaluate(
    ([name, action]) => {
      const { board } = window.__sculpt.reference;
      const item = name ? board.list().find((i) => i.name === name) : board.inView()[0];
      document.querySelector(`.ref-frame[data-id="${item.id}"] .ref-frame__btn--${action}`).click();
    },
    [name, action],
  );
  await page.waitForTimeout(350);
}

const setLookBlend = async (page, id) => {
  await page.selectOption('.ref-look__blend', id);
  await page.waitForTimeout(450);
};

const arrangingNow = (page) => page.evaluate(() => window.__sculpt.reference.view.describe().arranging);
async function lock(page) {
  if (await arrangingNow(page)) await page.click('.ref-arrangebtn');
  await page.waitForTimeout(350);
}
async function unlock(page) {
  if (!(await arrangingNow(page))) await page.click('.ref-arrangebtn');
  await page.waitForTimeout(350);
}

/** What the page shows at a point, from a real screenshot (the canvas and the pictures as composed). */
async function shotPixel(page, x, y) {
  const buf = await page.screenshot({ clip: { x: Math.round(x), y: Math.round(y), width: 1, height: 1 } });
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
  }, buf.toString('base64'));
}

async function pickView(page, label) {
  if (!(await page.evaluate(() => !!document.querySelector('.bz-menuname.is-open')))) {
    await page.evaluate(() => [...document.querySelectorAll('.bz-menuname')].find((b) => b.textContent === 'View')?.click());
    await page.waitForFunction(() => document.querySelector('.bz-menuname.is-open'), null, { timeout: 5000 });
  }
  await page.evaluate((l) => [...document.querySelectorAll('.file-menu--view .file-menu__item')].find((b) => (b.querySelector('.file-menu__label')?.textContent ?? '') === l)?.click(), label);
  await page.waitForTimeout(250);
}
const viewChecked = (page, label) =>
  page.evaluate((l) => [...document.querySelectorAll('.file-menu--view .file-menu__item')].find((b) => (b.querySelector('.file-menu__label')?.textContent ?? '') === l)?.getAttribute('aria-checked'), label);

export const suites = {
  async refBoard(page, base, t) {
    await openForInput(page, base);

    // The tab: after Tool and Material, the last on the right.
    const tabs = await page.evaluate(() => {
      const x = (cls) => document.querySelector(`.panel--${cls} > .panel__handle`)?.getBoundingClientRect().left ?? null;
      return { tool: x('sculpt'), material: x('material'), ref: x('reference') };
    });
    t.ok(tabs.ref !== null && tabs.tool < tabs.material && tabs.material < tabs.ref, `the Reference tab stands after Tool and Material (${JSON.stringify(tabs)})`);
    t.eq(await page.evaluate(() => document.querySelector('.panel--reference .panel__handle').textContent.trim()), 'Reference', 'the tab says Reference');

    // The View menu has the panel and the switch; the Edit menu has Paste picture.
    const menus = await page.evaluate(() => ({
      view: window.__sculpt.viewMenu.pop.textContent,
      edit: window.__sculpt.editMenu.pop.textContent,
    }));
    t.ok(menus.view.includes('Reference panel'), 'the View menu has "Reference panel"');
    t.ok(menus.view.includes('Arrange references') && menus.view.includes('References'), 'the View menu has "References" and "Arrange references"');
    t.ok(menus.edit.includes('Paste picture'), 'the Edit menu has "Paste picture"');

    // The panel opens from the View menu's command.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('bozzetto:panel-set', { detail: { id: 'reference', open: true } })));
    await page.waitForTimeout(150);
    t.ok(await visible(page, '.panel--reference'), 'the View menu command opens the panel');
    t.ok(await visible(page, '.ref-empty'), 'an empty board says how to add a picture');

    // The picker: a file input for pictures that leaves the choice (Photo Library, Take Photo, Choose File) to the system.
    const input = await page.evaluate(() => {
      const i = document.querySelector('.ref-file');
      return { accept: i.accept, capture: i.hasAttribute('capture'), type: i.type, multiple: i.multiple };
    });
    t.ok(input.type === 'file' && input.accept === 'image/*' && !input.capture, `Add picture… is a file input accepting image/* with no capture attribute (${JSON.stringify(input)})`);
    t.eq(await page.evaluate(() => document.querySelector('.ref-add').textContent), 'Add picture…', 'the button says Add picture…');

    await addFiles(page, [{ name: 'first.png', mimeType: 'image/png', buffer: await png(page, 400, 300) }]);
    await addFiles(page, [{ name: 'second.png', mimeType: 'image/png', buffer: await png(page, 300, 400) }]);
    t.eq((await names(page)).join(','), 'second,first', 'the board lists the newest first');
    const cards = await page.evaluate(() => [...document.querySelectorAll('.ref-card .ref-card__name')].map((e) => e.textContent));
    t.eq(cards.join(','), 'second,first', 'and so does the grid');
    await shot(page, 'board-two');

    // Paste: while the panel is open, a picture on the clipboard is added; with it closed, not.
    const paste = async (name) => {
      const bytes = [...(await png(page, 200, 200, { left: '#20c040' }))];
      await page.evaluate(
        ([bytes, name]) => {
          const dt = new DataTransfer();
          dt.items.add(new File([new Uint8Array(bytes)], name, { type: 'image/png' }));
          document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        },
        [bytes, name],
      );
      await page.waitForTimeout(700);
    };
    await paste('pasted.png');
    t.eq(await count(page), 3, 'a paste with the panel open adds the picture');
    t.eq((await names(page))[0], 'pasted', 'and it is first');
    await openPanel(page, false);
    await paste('ignored.png');
    t.eq(await count(page), 3, 'a paste with the panel closed is left alone');

    // Drop: onto the view, the picture is added to the board and placed where it fell.
    await openPanel(page);
    {
      const bytes = [...(await png(page, 160, 90, { left: '#c0c020' }))];
      await page.evaluate((bytes) => {
        const dt = new DataTransfer();
        dt.items.add(new File([new Uint8Array(bytes)], 'dropped.png', { type: 'image/png' }));
        const target = window.__sculpt.viewer.captureCanvas;
        const init = { dataTransfer: dt, bubbles: true, cancelable: true, clientX: 420, clientY: 330 };
        target.dispatchEvent(new DragEvent('dragover', init));
        target.dispatchEvent(new DragEvent('drop', init));
      }, bytes);
      await page.waitForFunction(() => window.__sculpt.reference.board.list().length === 4, null, { timeout: 10_000 });
      await page.waitForTimeout(500);
      t.eq((await names(page))[0], 'dropped', 'a picture dropped on the view is added to the board');
      t.eq(await inViewNames(page), 'dropped', 'and placed in the view');
      const at = await page.evaluate(() => {
        const f = document.querySelector('.ref-frame').getBoundingClientRect();
        return [f.left + f.width / 2, f.top + f.height / 2];
      });
      t.ok(Math.abs(at[0] - 420) < 4 && Math.abs(at[1] - 330) < 4, `where it was dropped (${at.map(Math.round)})`);
      t.ok(await page.evaluate(() => window.__sculpt.reference.view.describe().arranging), 'with Arrange on');
      // Dropped on the panel: a tile only.
      await page.evaluate((bytes) => {
        const dt = new DataTransfer();
        dt.items.add(new File([new Uint8Array(bytes)], 'ontile.png', { type: 'image/png' }));
        const r = document.querySelector('.panel--reference').getBoundingClientRect();
        const target = document.querySelector('.panel--reference');
        const init = { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 30, clientY: r.top + 200 };
        target.dispatchEvent(new DragEvent('dragover', init));
        target.dispatchEvent(new DragEvent('drop', init));
      }, bytes);
      await page.waitForFunction(() => window.__sculpt.reference.board.list().length === 5, null, { timeout: 10_000 });
      t.eq(await inViewNames(page), 'dropped', 'a picture dropped on the panel is a tile on the board, not in the view');
      await page.evaluate(() => window.__sculpt.reference.board.remove(window.__sculpt.reference.board.list()[0].id));
      await page.waitForTimeout(150);
    }

    // The row menu.
    await page.locator('.ref-card:nth-child(1) .row-more').click();
    const labels = await page.evaluate(() => [...document.querySelectorAll('.ref-card:nth-child(1) .row-menu .file-menu__item')].map((b) => b.textContent));
    t.eq(labels.join('|'), 'Remove from view|Match viewLock the picture first|Mirror|Greyscale|Delete', 'the row menu has Remove from view (it is in the view), Match view, Mirror, Greyscale and Delete');
    await page.keyboard.press('Escape');

    // Delete asks first; Cancel keeps it, Delete removes it.
    await cardAction(page, 1, 'ref-act-delete');
    t.ok(await visible(page, '.bz-ask'), 'Delete asks first');
    t.ok(await page.evaluate(() => document.querySelector('.bz-ask-yes').classList.contains('btn--danger')), 'and its button is the red one');
    await page.click('.bz-ask-cancel');
    t.eq(await count(page), 4, 'Cancel keeps the picture');
    await cardAction(page, 1, 'ref-act-delete');
    await page.click('.bz-ask-yes');
    await page.waitForTimeout(200);
    t.eq(await count(page), 3, 'Delete removes it');
    await shot(page, 'board-after-delete');

    // Armature has the same tab, after its own.
    await openArmature(page, base);
    const arm = await page.evaluate(() => ({
      has: !!document.querySelector('.panel--reference'),
      view: window.__armature.viewMenu?.pop?.textContent ?? '',
    }));
    t.ok(arm.has, 'Armature has the Reference tab too');
  },

  async refImport(page, base, t) {
    await openForInput(page, base);
    await openPanel(page);
    // A large picture is scaled to 2048 on its long side and written as JPEG.
    await addFiles(page, [{ name: 'big.png', mimeType: 'image/png', buffer: await png(page, 3000, 1500) }]);
    let b = await board(page);
    t.ok(b[0].w === 2048 && b[0].h === 1024 && b[0].type === 'image/jpeg', `3000x1500 comes in as 2048x1024 JPEG (${JSON.stringify(b[0])})`);
    // A small one keeps its size.
    await addFiles(page, [{ name: 'small.png', mimeType: 'image/png', buffer: await png(page, 200, 100) }]);
    b = await board(page);
    t.ok(b[0].w === 200 && b[0].h === 100 && b[0].type === 'image/jpeg', `an opaque PNG becomes a JPEG at its own size (${JSON.stringify(b[0])})`);
    // Transparency keeps PNG.
    await addFiles(page, [{ name: 'clear.png', mimeType: 'image/png', buffer: await png(page, 200, 100, { transparent: true }) }]);
    b = await board(page);
    t.eq(b[0].type, 'image/png', 'a picture with transparency stays a PNG');
    const heads = await page.evaluate(async () =>
      Promise.all(window.__sculpt.reference.board.list().map(async (i) => [...new Uint8Array(await i.blob.slice(0, 4).arrayBuffer())])),
    );
    t.ok(heads[0][0] === 0x89 && heads[0][1] === 0x50 && heads[1][0] === 0xff && heads[1][1] === 0xd8, 'the stored bytes are a PNG and a JPEG');

    // EXIF is gone: a JPEG with a GPS block and a description goes in, none of it comes out.
    const { bytes, marker } = await exifJpeg(page);
    t.ok(bytes.includes(Buffer.from('Exif')) && bytes.includes(Buffer.from(marker)), 'the test file does carry an EXIF block and its text');
    await addFiles(page, [{ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: bytes }]);
    const out = await page.evaluate(async () => {
      const item = window.__sculpt.reference.board.list()[0];
      return { type: item.blob.type, bytes: [...new Uint8Array(await item.blob.arrayBuffer())] };
    });
    const stored = Buffer.from(out.bytes);
    t.eq(out.type, 'image/jpeg', 'the photo is stored as a JPEG');
    t.ok(!stored.includes(Buffer.from('Exif')), 'no EXIF block is left in the stored picture');
    t.ok(!stored.includes(Buffer.from(marker)) && !stored.includes(Buffer.from('SECRET-PLACE')), 'nor the description or the place in it');
    let app1 = false;
    for (let i = 2; i + 3 < stored.length && stored[i] === 0xff; ) {
      const m = stored[i + 1];
      if (m === 0xe1) app1 = true;
      if (m === 0xda) break;
      i += 2 + stored.readUInt16BE(i + 2);
    }
    t.ok(!app1, 'and no APP1 segment');

    // Not a picture: said, and nothing added.
    const before = await count(page);
    await page.setInputFiles('.ref-file', [{ name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from('this is not a picture') }]);
    await page.waitForTimeout(800);
    t.eq(await count(page), before, 'a file that is not a picture adds nothing');
    t.ok(await page.evaluate(() => !!document.querySelector('.sculpt-toast')), 'and says so');
  },

  async refShow(page, base, t) {
    await page.setViewportSize({ width: 1180, height: 820 });
    await openForInput(page, base);
    await openPanel(page);
    await addFiles(page, [{ name: 'first.png', mimeType: 'image/png', buffer: await png(page, 400, 300) }]);
    await addFiles(page, [{ name: 'second.png', mimeType: 'image/png', buffer: await png(page, 300, 400) }]);
    t.eq(await inViewNames(page), '', 'nothing is in the view until a picture is put there');
    t.ok(!(await visible(page, '.ref-frame')), 'no frames, no outline');
    t.ok(!(await visible(page, '.ref-arrangebtn')), 'and the Arrange button is not on the edge');
    t.ok(await page.evaluate(() => document.querySelector('.ref-arrange').disabled), 'the panel’s Arrange button waits for a picture in the view');

    // A tap on a tile only selects: it does not put the picture in the view.
    await page.locator('.ref-card:nth-child(2) .ref-card__thumb').click();
    await page.waitForTimeout(200);
    t.eq(await inViewNames(page), '', 'a tap on a tile does not put it in the view');

    // Drag a tile (first.png, the second tile) into the view with the mouse.
    await dragTile(page, 2, [480, 300], 'mouse');
    t.eq(await inViewNames(page), 'first', 'dragging a tile into the view puts the picture there');
    t.ok(await page.evaluate(() => window.__sculpt.reference.view.describe().arranging), 'and Arrange turns on');
    const place = await page.evaluate(() => {
      const id = window.__sculpt.reference.board.inView()[0].id;
      const f = document.querySelector(`.ref-frame[data-id="${id}"]`).getBoundingClientRect();
      return { cx: f.left + f.width / 2, cy: f.top + f.height / 2, w: f.width };
    });
    t.ok(Math.abs(place.cx - 480) < 3 && Math.abs(place.cy - 300) < 3, `the picture is placed where it was let go (${Math.round(place.cx)},${Math.round(place.cy)})`);
    t.ok(place.w > 150 && place.w < 500, `at a sensible default size (${Math.round(place.w)}px wide)`);
    await page.waitForTimeout(300);
    t.ok(isRed(await picPixel(page, 0.2, 0.2)) && isBlue(await picPixel(page, 0.8, 0.2)), 'the picture is drawn (red left, blue right)');

    // The selected tile is the grey fill, not an orange outline.
    const grey = await page.evaluate(() => {
      const c = document.querySelector('.ref-card:nth-child(2)');
      const cs = getComputedStyle(c);
      const row = document.createElement('div');
      row.style.background = 'var(--bz-hover)';
      document.body.appendChild(row);
      const hover = getComputedStyle(row).backgroundColor;
      row.remove();
      const off = getComputedStyle(document.querySelector('.ref-card:nth-child(1)')).backgroundColor;
      return { on: c.classList.contains('ref-card--on'), bg: cs.backgroundColor, hover, off, outline: cs.outlineStyle, pressed: c.querySelector('.ref-card__thumb').getAttribute('aria-pressed') };
    });
    t.ok(grey.on && grey.bg === grey.hover && grey.off !== grey.hover && grey.pressed === 'true', `the tile in the view has the grey selected fill (${JSON.stringify(grey)})`);
    t.eq(grey.outline, 'none', 'and no orange outline');

    // Arranging: an outline, corner marks and a row of five 44px buttons, named.
    const arr = await page.evaluate(() => {
      const f = document.querySelector('.ref-frame');
      const btns = [...f.querySelectorAll('.ref-frame__btn')].map((b) => ({ name: b.getAttribute('aria-label'), title: b.title, w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height, icon: !!b.querySelector('.fi') }));
      const cs = getComputedStyle(f);
      return { corners: f.querySelectorAll('.ref-frame__corner').length, border: cs.borderTopWidth, btns };
    });
    t.eq(arr.btns.map((b) => b.name).join(','), 'Lock,Fit,Flip,Look,Remove from view', 'the row has Lock, Fit, Flip, Look and Remove from view');
    t.ok(arr.btns.every((b) => b.w >= 44 && b.h >= 44 && b.icon && b.title === b.name), 'each is an icon, 44px, with its name');
    t.ok(arr.corners === 4 && arr.border === '1px', 'a thin outline and four corner marks');
    await shot(page, 'arranging');

    // The edge button: shown now, orange while arranging, toggles.
    const edge = () =>
      page.evaluate(() => {
        const b = document.querySelector('.ref-arrangebtn');
        const probe = document.createElement('i');
        probe.style.color = 'var(--bz-orange)';
        document.body.appendChild(probe);
        const orange = getComputedStyle(probe).color;
        probe.remove();
        const bg = getComputedStyle(b).backgroundColor;
        return { shown: !!b && b.getClientRects().length > 0, pressed: b?.getAttribute('aria-pressed'), orange: getComputedStyle(b).color === orange, noSquare: bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent', inColumn: !!b.closest('.bz-edge') };
      });
    let e = await edge();
    t.ok(e.shown && e.inColumn && e.pressed === 'true' && e.orange && e.noSquare, `the edge button is there, orange with no square, while arranging (${JSON.stringify(e)})`);

    // Drag by the mouse and by the Pencil; wheel and corner scale.
    const frame = () => page.evaluate(() => document.querySelector('.ref-frame').getBoundingClientRect().toJSON());
    const f0 = await frame();
    await page.mouse.move(f0.left + f0.width / 2, f0.top + f0.height / 2);
    await page.mouse.down();
    await page.mouse.move(f0.left + f0.width / 2 + 120, f0.top + f0.height / 2 + 80, { steps: 8 });
    await page.mouse.up();
    const f1 = await frame();
    t.ok(Math.abs(f1.left - f0.left - 120) < 3 && Math.abs(f1.top - f0.top - 80) < 3, 'dragging the picture with the mouse moves it');
    const cdp = await page.context().newCDPSession(page);
    const pen = (type, x, y, buttons) =>
      cdp.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1, pointerType: 'pen', force: 0.6 });
    const px = f1.left + f1.width / 2;
    const py = f1.top + f1.height / 2;
    await pen('mouseMoved', px, py, 0);
    await pen('mousePressed', px, py, 1);
    for (let i = 1; i <= 6; i++) await pen('mouseMoved', px - i * 10, py + i * 5, 1);
    await pen('mouseReleased', px - 60, py + 30, 0);
    const f2 = await frame();
    t.ok(Math.abs(f2.left - f1.left + 60) < 3 && Math.abs(f2.top - f1.top - 30) < 3, 'the Pencil on the picture moves it too');
    await page.mouse.move(f2.left + f2.width / 2, f2.top + f2.height / 2);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(100);
    const f3 = await frame();
    t.ok(f3.width > f2.width * 1.2, `the wheel scales it (${Math.round(f2.width)} to ${Math.round(f3.width)})`);
    // The south east corner: the north west corner stays.
    await page.mouse.move(f3.right - 2, f3.bottom - 2);
    await page.mouse.down();
    await page.mouse.move(f3.right - 2 - 60, f3.bottom - 2, { steps: 5 });
    await page.mouse.up();
    const f4 = await frame();
    t.ok(f4.width < f3.width - 40 && Math.abs(f4.left - f3.left) < 2 && Math.abs(f4.top - f3.top) < 2, `dragging a corner resizes it, the opposite corner staying (${Math.round(f3.width)} to ${Math.round(f4.width)})`);
    // The north west corner moves the other way: the south east corner stays.
    await page.mouse.move(f4.left + 1, f4.top + 1);
    await page.mouse.down();
    await page.mouse.move(f4.left + 1 + 30, f4.top + 1 + 30, { steps: 5 });
    await page.mouse.up();
    const f5 = await frame();
    t.ok(f5.width < f4.width - 10 && Math.abs(f5.right - f4.right) < 2 && Math.abs(f5.bottom - f4.bottom) < 2, 'and the north west corner works the same');

    // Fit: the picture fills the view, its aspect kept.
    await frameButton(page, 'fit');
    const fit = await page.evaluate(() => {
      const v = window.__sculpt.viewer.captureCanvas.getBoundingClientRect();
      const f = document.querySelector('.ref-frame').getBoundingClientRect();
      return { fw: f.width, fh: f.height, vw: v.width, vh: v.height, cx: f.left + f.width / 2 - (v.left + v.width / 2), cy: f.top + f.height / 2 - (v.top + v.height / 2) };
    });
    t.ok((Math.abs(fit.fh - fit.vh) < 2 || Math.abs(fit.fw - fit.vw) < 2) && fit.fw <= fit.vw + 1 && fit.fh <= fit.vh + 1 && Math.abs(fit.cx) < 2 && Math.abs(fit.cy) < 2, `Fit fills the view, centred (${JSON.stringify(fit)})`);
    t.near(fit.fw / fit.fh, 4 / 3, 0.02, 'and keeps the aspect');

    // Flip mirrors.
    await frameButton(page, 'flip');
    await page.waitForTimeout(300);
    t.ok(isBlue(await picPixel(page, 0.2, 0.2)) && isRed(await picPixel(page, 0.8, 0.2)), 'Flip swaps left and right');

    // Look: a pop-up with the blend select (Behind, Normal, the modes in Photoshop's order), Opacity and Greyscale.
    await frameButton(page, 'look');
    t.ok(await visible(page, '.ref-look'), 'Look opens a small pop-up');
    const opts = await page.evaluate(() => {
      const g = [[]];
      for (const o of document.querySelectorAll('.ref-look__blend option')) {
        if (o.disabled) g.push([]);
        else g[g.length - 1].push(o.textContent);
      }
      return g.map((x) => x.join(',')).join('|');
    });
    t.eq(
      opts,
      'Behind,Normal|Darken,Multiply,Color Burn|Lighten,Screen,Color Dodge,Linear Dodge (Add)|Overlay,Soft Light,Hard Light|Difference,Exclusion|Hue,Saturation,Color,Luminosity',
      'the blend select lists Behind, Normal and the CSS-matched modes in Photoshop’s order, groups between lines',
    );
    t.ok(await page.evaluate(() => !!document.querySelector('.ref-look input[type=range]') && !!document.querySelector('.ref-look input[type=checkbox]')), 'with Opacity and Greyscale');
    await shot(page, 'look');
    // Pixels: Normal against Multiply, read from a real screenshot of the view as composed. Locked first, so no outline is in it.
    await setLookBlend(page, 'normal');
    await lock(page);
    const spot = [300, 700];
    const normalPx = await shotPixel(page, ...spot);
    t.ok(isBlue(normalPx) || isRed(normalPx), `Normal at full strength shows the picture (${normalPx})`);
    await unlock(page);
    await frameButton(page, 'look');
    await setLookBlend(page, 'multiply');
    t.eq(await page.evaluate(() => document.querySelector('.ref-pic').style.mixBlendMode), 'multiply', 'Multiply sets the picture’s mix-blend-mode');
    await lock(page);
    const mulPx = await shotPixel(page, ...spot);
    t.ok(Math.abs(mulPx[0] - normalPx[0]) + Math.abs(mulPx[2] - normalPx[2]) > 60, `Multiply changes the pixels of the view compared with Normal (${normalPx} to ${mulPx})`);
    const mm = await meshCentre(page);
    await unlock(page);
    await frameButton(page, 'look');
    await setLookBlend(page, 'normal');
    await lock(page);
    const modelNormal = await shotPixel(page, mm[0] - 120, mm[1]);
    await unlock(page);
    await frameButton(page, 'look');
    await setLookBlend(page, 'screen');
    await lock(page);
    const modelScreen = await shotPixel(page, mm[0] - 120, mm[1]);
    t.ok(modelNormal.some((v, i) => Math.abs(v - modelScreen[i]) > 20), `a mode blends with the model too (${modelNormal} to ${modelScreen})`);
    await unlock(page);
    // Opacity.
    await frameButton(page, 'look');
    await setLookBlend(page, 'normal');
    await page.evaluate(() => {
      const s = document.querySelector('.ref-look input[type=range]');
      s.value = '30';
      s.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(300);
    t.near(Number(await page.evaluate(() => getComputedStyle(document.querySelector('.ref-pic')).opacity)), 0.3, 0.02, 'Opacity sets how strongly it shows');
    // Greyscale.
    await page.locator('.ref-look input[type=checkbox]').check();
    await page.waitForTimeout(300);
    t.ok(isGrey(await picPixel(page, 0.2, 0.2)) && isGrey(await picPixel(page, 0.8, 0.2)), 'Greyscale takes the colour out');
    await page.locator('.ref-look input[type=checkbox]').uncheck();
    await page.waitForTimeout(200);
    // Behind: under the model, no overlay element; Opacity applies to it too.
    await setLookBlend(page, 'behind');
    const dBehind = await page.evaluate(() => window.__sculpt.reference.view.describe());
    t.ok(dBehind.behind && !dBehind.pictures[0].element && !(await visible(page, '.ref-pic')), `Behind draws under the model, as no overlay (${JSON.stringify(dBehind)})`);
    t.near(dBehind.pictures[0].opacity, 0.3, 0.02, 'with the same opacity');
    await lock(page);
    await page.waitForTimeout(400);
    const midBehind = await sample(page, mm[0], mm[1]);
    t.ok(!isRed(midBehind) && !isBlue(midBehind), 'the model stands in front of a picture behind it');
    await unlock(page);
    await frameButton(page, 'look');
    await setLookBlend(page, 'normal');
    t.eq(await page.evaluate(() => window.__sculpt.reference.board.list().find((i) => i.name === 'first').blend), 'normal', 'the blend is kept with the picture');
    await shot(page, 'look-normal');

    // Remove from view: it stays on the board.
    await frameButton(page, 'remove');
    t.eq(await inViewNames(page), '', 'Remove from view takes it out of the view');
    t.eq(await count(page), 2, 'and the tile stays on the board');
    t.ok(!(await visible(page, '.ref-frame')) && !(await visible(page, '.ref-arrangebtn')), 'the frame and the edge button go');
    t.ok(!(await page.evaluate(() => document.querySelector('.ref-card:nth-child(2)').classList.contains('ref-card--on'))), 'and the tile is not grey');

    // Place in view (the row menu), for a hand that cannot drag.
    await cardAction(page, 2, 'ref-act-place');
    t.eq(await inViewNames(page), 'first', 'Place in view puts it in the view');
    t.ok(await page.evaluate(() => window.__sculpt.reference.view.describe().arranging), 'and Arrange turns on');
    // Two pictures at once.
    await dragTile(page, 1, [520, 560], 'mouse');
    t.eq(await inViewNames(page), 'first,second', 'two pictures are in the view at once');
    t.eq(await page.evaluate(() => document.querySelectorAll('.ref-frame').length), 2, 'each with its own frame');

    // Lock: no outline, no icons, and the pictures pass everything through.
    await lock(page);
    t.ok(!(await visible(page, '.ref-frame')), 'Lock removes the outlines and icons');
    t.eq(await page.evaluate(() => window.__sculpt.reference.view.describe().arranging), false, 'and arranging is off');
    t.eq(await inViewNames(page), 'first,second', 'the pictures stay');
    e = await edge();
    t.ok(e.shown && e.pressed === 'false' && !e.orange, `the edge button is neutral while locked (${JSON.stringify(e)})`);
    const pass = await page.evaluate(() => {
      const pics = [...document.querySelectorAll('.ref-pic')];
      const r = pics[0].getBoundingClientRect();
      const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { pe: pics.map((p) => getComputedStyle(p).pointerEvents), layer: getComputedStyle(document.querySelector('.ref-layer')).pointerEvents, tag: e?.tagName, inPic: !!e?.closest('.ref-layer') };
    });
    t.ok(pass.pe.every((p) => p === 'none') && pass.layer === 'none' && pass.tag === 'CANVAS' && !pass.inPic, `locked pictures are pass-through: the element under them is the view's canvas (${JSON.stringify(pass)})`);
    await shot(page, 'locked');

    // The edge button unlocks again and the panel's button locks.
    await page.click('.ref-arrangebtn');
    t.ok(await page.evaluate(() => window.__sculpt.reference.view.describe().arranging), 'the edge button unlocks');
    t.eq(await page.evaluate(() => document.querySelector('.ref-arrange').textContent), 'Lock', 'and the panel button then says Lock');
    await page.click('.ref-arrange');
    t.eq(await page.evaluate(() => window.__sculpt.reference.view.describe().arranging), false, 'the panel button locks');
    t.eq(await page.evaluate(() => document.querySelector('.ref-arrange').textContent), 'Arrange', 'and says Arrange');

    // The View menu.
    const viewLabels = await page.evaluate(() => window.__sculpt.viewMenu.pop.textContent);
    t.ok(viewLabels.includes('References') && viewLabels.includes('Arrange references'), 'View has References and Arrange references');
    t.ok(!viewLabels.includes('Reference beside the view') && !viewLabels.includes('Reference over the view'), 'and the old beside and over items are gone');
    await pickView(page, 'Arrange references');
    t.ok(await page.evaluate(() => window.__sculpt.reference.view.describe().arranging), 'View > Arrange references unlocks');
    t.eq(await viewChecked(page, 'Arrange references'), 'true', 'with a check');
    await page.keyboard.press('Escape');
    await pickView(page, 'Arrange references');
    t.eq(await page.evaluate(() => window.__sculpt.reference.view.describe().arranging), false, 'and locks again');
    await page.keyboard.press('Escape');
    await pickView(page, 'References');
    await page.waitForTimeout(300);
    t.ok(!(await visible(page, '.ref-pic')), 'View > References off hides all the pictures');
    await page.keyboard.press('Escape');
    await pickView(page, 'References');
    await page.waitForTimeout(400);
    t.ok(await visible(page, '.ref-pic'), 'and on brings them back');
    await page.keyboard.press('Escape');

    // The picture and the pixel under a point: what a projection tool asks.
    const hit = await page.evaluate(() => {
      const pics = window.__sculpt.reference.view.picturesInView();
      const top = pics[pics.length - 1];
      const h = window.__sculpt.reference.view.imageAt(top.left + top.width / 2, top.top + top.height / 2);
      return { n: pics.length, name: h?.item.name, x: h?.x, y: h?.y, w: h?.item.width, h: h?.item.height };
    });
    t.ok(hit.n === 2 && hit.name === 'second' && Math.abs(hit.x - hit.w / 2) <= 1 && Math.abs(hit.y - hit.h / 2) <= 1, `imageAt names the topmost picture and the image pixel under a point (${JSON.stringify(hit)})`);

    // Match view: disabled until a picture was locked; locking keeps the camera; it brings it back.
    await page.evaluate(() => window.__sculpt.reference.board.clear());
    await page.waitForTimeout(200);
    await addFiles(page, [{ name: 'cam.png', mimeType: 'image/png', buffer: await png(page, 400, 300) }]);
    await page.locator('.ref-card:nth-child(1) .row-more').click();
    const matchOff = await page.evaluate(() => {
      const b = document.querySelector('.ref-card:nth-child(1) .ref-act-match');
      return { disabled: b.disabled, text: b.textContent };
    });
    t.ok(matchOff.disabled && matchOff.text.includes('Match view') && matchOff.text.includes('Lock the picture first'), `Match view is disabled with the hint until a picture is locked (${JSON.stringify(matchOff)})`);
    await page.keyboard.press('Escape');
    await cardAction(page, 1, 'ref-act-place');
    const cam0 = await page.evaluate(() => window.__sculpt.viewer.camera.position.toArray());
    await lock(page);
    t.ok(await page.evaluate(() => !!window.__sculpt.reference.board.list()[0].camera), 'locking keeps the camera with the picture');
    await page.evaluate(() => window.__sculpt.viewer.orbitAzimuth(50));
    await page.waitForTimeout(500);
    const camAway = await page.evaluate(() => window.__sculpt.viewer.camera.position.toArray());
    t.ok(camAway.some((v, i) => Math.abs(v - cam0[i]) > 0.05), 'the camera was moved away');
    await cardAction(page, 1, 'ref-act-match');
    await page.waitForTimeout(500);
    const camBack = await page.evaluate(() => window.__sculpt.viewer.camera.position.toArray());
    t.ok(camBack.every((v, i) => Math.abs(v - cam0[i]) < 0.02), `Match view puts the camera back (${cam0.map((v) => v.toFixed(2))} against ${camBack.map((v) => v.toFixed(2))})`);

    // The same drag with the Pencil, and with a finger (held, and at once sideways).
    await page.evaluate(() => window.__sculpt.reference.board.clear());
    await page.waitForTimeout(200);
    await addFiles(page, [{ name: 'p1.png', mimeType: 'image/png', buffer: await png(page, 400, 300) }]);
    await dragTile(page, 1, [480, 300], 'pen');
    t.eq(await inViewNames(page), 'p1', 'the Pencil drags a tile into the view');
    await page.evaluate(() => window.__sculpt.reference.board.takeOut(window.__sculpt.reference.board.list()[0].id));
    await dragTile(page, 1, [480, 300], 'touch-hold');
    t.eq(await inViewNames(page), 'p1', 'a finger that holds a tile then drags puts it in the view');
    await page.evaluate(() => window.__sculpt.reference.board.takeOut(window.__sculpt.reference.board.list()[0].id));
    await dragTile(page, 1, [20, 300], 'touch-side').catch(() => {});
    await page.evaluate(() => window.__sculpt.reference.board.takeOut(window.__sculpt.reference.board.list()[0]?.id));
  },

  async refInput(page, base, t) {
    await page.setViewportSize({ width: 1180, height: 820 });
    await openForInput(page, base);
    await openPanel(page);
    await addFiles(page, [{ name: 'first.png', mimeType: 'image/png', buffer: await png(page, 400, 300) }]);
    await addFiles(page, [{ name: 'second.png', mimeType: 'image/png', buffer: await png(page, 300, 400) }]);
    // Both pictures in the view, one fitted over the model: a film across the whole view.
    await dragTile(page, 1, [480, 640], 'mouse');
    await dragTile(page, 2, [480, 300], 'mouse');
    await frameButtonOf(page, 'first', 'fit');
    await frameButtonOf(page, 'first', 'look');
    await setLookBlend(page, 'normal');
    await openPanel(page, false);
    t.eq(await inViewNames(page), 'second,first', 'two pictures are in the view');
    t.ok(await page.evaluate(() => window.__sculpt.reference.view.describe().arranging), 'and Arrange is on');

    // Arranging: the model outside the pictures is worked as always.
    const [cx, cy] = await meshCentre(page);
    const cdp = await page.context().newCDPSession(page);
    const pen = (type, x, y, buttons) =>
      cdp.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1, pointerType: 'pen', force: 0.6 });
    const stroke = async (x, y) => {
      await pen('mouseMoved', x - 40, y, 0);
      await pen('mousePressed', x - 40, y, 1);
      for (let i = 1; i <= 8; i++) await pen('mouseMoved', x - 40 + i * 10, y + i * 2, 1);
      await pen('mouseReleased', x + 40, y + 16, 0);
      await page.waitForTimeout(350);
    };
    // Put the fitted picture away from the model while arranging: shrink it to the corner.
    await page.evaluate(() => {
      const { board, view } = window.__sculpt.reference;
      const item = board.list().find((i) => i.name === 'first');
      board.setPlace(item.id, { x: -0.5, y: -0.3, w: 0.2 });
      board.setPlace(board.list().find((i) => i.name === 'second').id, { x: 0.45, y: -0.3, w: 0.12 });
    });
    await page.keyboard.press('3');
    const before = await meshSum(page);
    await stroke(cx, cy);
    t.ok((await meshSum(page)) !== before, 'while arranging, a Pencil stroke on the model outside the pictures sculpts');
    const top = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [cx, cy]);
    t.eq(top, 'CANVAS', 'the element under the model is the canvas');

    // Locked, with a picture fitted across the model: every mode passes everything through.
    await page.evaluate(() => {
      const { board, view } = window.__sculpt.reference;
      const item = board.list().find((i) => i.name === 'first');
      board.setPlace(item.id, view.fitPlace(item));
    });
    await lock(page);
    t.ok(!(await visible(page, '.ref-frame')), 'locked: no outlines or icons');
    for (const mode of ['normal', 'multiply', 'screen', 'overlay', 'difference', 'luminosity']) {
      await page.evaluate((m) => {
        const { board } = window.__sculpt.reference;
        board.setLook(board.list().find((i) => i.name === 'first').id, { blend: m });
      }, mode);
      await page.waitForTimeout(250);
      const under = await page.evaluate(([x, y]) => {
        const e = document.elementFromPoint(x, y);
        return { tag: e?.tagName, inLayer: !!e?.closest('.ref-layer, .ref-chrome') };
      }, [cx, cy]);
      t.ok(under.tag === 'CANVAS' && !under.inLayer, `a locked picture in ${mode} takes no pointer (${JSON.stringify(under)})`);
      const strokes0 = await page.evaluate(() => window.__sculpt.input.strokeCount());
      const m0 = await meshSum(page);
      await stroke(cx, cy + 20);
      t.ok((await meshSum(page)) !== m0, `a Pencil stroke through the locked picture in ${mode} sculpts`);
      t.eq(await page.evaluate(() => window.__sculpt.input.strokeCount()), strokes0 + 1, `and is one stroke, begun and ended (${mode})`);
    }
    // A finger orbits through it; two fingers too.
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const cam = () => page.evaluate(() => window.__sculpt.viewer.camera.position.toArray());
    const c0 = await cam();
    await touch('touchStart', [{ x: 200, y: 600, id: 1 }]);
    for (let i = 1; i <= 8; i++) await touch('touchMove', [{ x: 200 + i * 12, y: 600, id: 1 }]);
    await touch('touchEnd', []);
    await page.waitForTimeout(400);
    const c1 = await cam();
    t.ok(c1.some((v, i) => Math.abs(v - c0[i]) > 1e-4), 'a finger drag through the locked picture orbits the view');
    await touch('touchStart', [{ x: 300, y: 500, id: 1 }, { x: 400, y: 500, id: 2 }]);
    for (let i = 1; i <= 8; i++) await touch('touchMove', [{ x: 300 - i * 8, y: 500, id: 1 }, { x: 400 + i * 8, y: 500, id: 2 }]);
    await touch('touchEnd', []);
    await page.waitForTimeout(400);
    const c2 = await cam();
    t.ok(c2.some((v, i) => Math.abs(v - c1[i]) > 1e-4), 'a two-finger gesture through the locked picture reaches the view');
    t.eq(await page.evaluate(() => window.__sculpt.reference.board.inView().length), 2, 'and both pictures are still there');

    // Tab: the outlines and icons go with the interface, the pictures stay.
    await page.evaluate(() => window.__sculpt.reference.board.setArranging(true));
    await page.waitForTimeout(300);
    t.ok(await visible(page, '.ref-frame'), 'arranging shows the frames');
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);
    t.ok(await page.evaluate(() => document.body.classList.contains('chrome-hidden')), 'Tab hides the interface');
    // The outlines fade out (180ms, then visibility flips): wait for the end of it, a real fault stays visible.
    await page
      .waitForFunction(() => { const c = document.querySelector('.ref-chrome'); return !c || getComputedStyle(c).visibility === 'hidden'; }, null, { timeout: 5000 })
      .catch(() => {});
    t.ok(!(await visible(page, '.ref-frame')), `the outlines and icons go with it ${await page.evaluate(() => { const c = document.querySelector('.ref-chrome'); const f = document.querySelector('.ref-frame'); return JSON.stringify({ c: c && [getComputedStyle(c).visibility, getComputedStyle(c).opacity, c.parentElement.tagName], f: f && getComputedStyle(f).visibility }); })}`);
    t.ok(await visible(page, '.ref-pic'), 'the pictures stay');
    await shot(page, 'chrome-hidden');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);
    t.ok(await visible(page, '.ref-frame'), 'and the outlines come back with it');
  },

  async refKeep(page, base, t) {
    await openForInput(page, base);
    await openPanel(page);
    await addFiles(page, [{ name: 'one.png', mimeType: 'image/png', buffer: await png(page, 400, 300) }]);
    await addFiles(page, [{ name: 'two.png', mimeType: 'image/png', buffer: await png(page, 300, 400) }]);
    await cardAction(page, 1, 'ref-act-mirror');
    await cardAction(page, 1, 'ref-act-place');
    await page.evaluate(() => {
      const { board } = window.__sculpt.reference;
      const item = board.list()[0];
      board.setPlace(item.id, { x: 0.21, y: -0.13, w: 0.37 });
      board.setLook(item.id, { blend: 'multiply', opacity: 0.4 });
    });
    await lock(page);
    const camKept = await page.evaluate(() => window.__sculpt.reference.board.list()[0].camera);
    await page.evaluate(() => window.__sculpt.reference.board.flush());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__sculpt, null, { timeout: 90_000 });
    await page.waitForFunction(() => window.__sculpt.reference.board.list().length === 2, null, { timeout: 15_000 }).catch(() => {});
    const after = await board(page);
    t.eq(after.map((b) => b.name).join(','), 'two,one', 'a reload brings the pictures back, in the same order');
    t.ok(after[0].mirror && !after[1].mirror, 'with how each was drawn');
    await page.waitForTimeout(600);
    t.eq(await inViewNames(page), 'two', 'and the one that was in the view is in it');
    const kept = await page.evaluate(() => {
      const i = window.__sculpt.reference.board.list()[0];
      return { place: i.place, blend: i.blend, opacity: i.opacity, camera: i.camera };
    });
    t.ok(kept.place && Math.abs(kept.place.x - 0.21) < 1e-6 && Math.abs(kept.place.y + 0.13) < 1e-6 && Math.abs(kept.place.w - 0.37) < 1e-6, `with its place (${JSON.stringify(kept.place)})`);
    t.ok(kept.blend === 'multiply' && Math.abs(kept.opacity - 0.4) < 1e-6, 'its blend mode and opacity');
    t.eq(JSON.stringify(kept.camera), JSON.stringify(camKept), 'and the camera kept when it was locked');
    t.eq(await arrangingNow(page), false, 'a scene opens locked');
    t.ok(!(await visible(page, '.ref-frame')), 'with no outlines');
    t.ok(await visible(page, '.ref-pic'), 'and the picture drawn');

    // New sculpt starts with an empty board, and a reload after it has none.
    await page.evaluate(() => window.__sculpt.fileActions.newScene());
    await page.waitForTimeout(500);
    t.eq(await count(page), 0, 'New sculpt starts with an empty board');
    t.eq(await inViewNames(page), '', 'and nothing in the view');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__sculpt, null, { timeout: 90_000 });
    await page.waitForTimeout(800);
    t.eq(await count(page), 0, 'a reload after it brings none back');

    // A library project: kept under its id as well, so reopening it here brings them back; another device has none.
    await openPanel(page);
    await addFiles(page, [{ name: 'proj.png', mimeType: 'image/png', buffer: await png(page, 400, 300) }]);
    await page.evaluate(() => {
      window.__sculpt.fileActions.setLink({ id: 'proj-a', title: 'Project A' });
    });
    await page.waitForTimeout(200);
    t.ok(await page.evaluate(() => document.querySelector('.ref-note').textContent.includes('never uploaded')), 'a library project’s panel says they are never uploaded');
    t.eq(await page.evaluate(() => document.querySelector('.ref-note').textContent), 'References stay on the device they were added on and are never uploaded.', 'the panel says where they stay');
    await page.evaluate(() => window.__sculpt.reference.board.flush());
    await page.evaluate(async () => {
      const { board } = window.__sculpt.reference;
      await board.clear(); // the autosave's pictures go, as a new scene's do
    });
    t.eq(await count(page), 0, 'the board is empty');
    await page.evaluate(() => window.__sculpt.reference.board.restore({ project: 'proj-a' }));
    t.eq(await count(page), 1, 'reopening the project on this device brings its pictures back');
    await page.evaluate(() => window.__sculpt.reference.board.restore({ project: 'proj-b' }));
    t.eq(await count(page), 0, 'a project that was never opened here has none');

    // Keeping off: they last for the page only.
    const ctx = await page.context().browser().newContext({ viewport: { width: 1280, height: 800 }, askAboutDevice: true });
    const p2 = await ctx.newPage();
    const errors = [];
    p2.on('pageerror', (e) => errors.push(String(e)));
    try {
      // Declined, as a visitor says no (the question is the device suite's own).
      await p2.goto(`${base}/?sculpt=1&q=low`, { waitUntil: 'domcontentloaded' });
      await p2.waitForSelector('.bz-device', { timeout: 60_000 });
      await p2.click('.bz-device-decline');
      await p2.click('.bz-device-off');
      await p2.waitForFunction(() => !!window.__sculpt, null, { timeout: 90_000 });
      await p2.waitForTimeout(500);
      await openPanel(p2);
      await addFiles(p2, [{ name: 'temp.png', mimeType: 'image/png', buffer: await png(p2, 300, 300) }]);
      t.eq(await count(p2), 1, 'with keeping off a picture can still be added');
      t.ok((await p2.evaluate(() => document.querySelector('.ref-note').textContent)).includes('Saving on this device is off'), 'and the panel says it lasts until the page closes');
      await p2.evaluate(() => window.__sculpt.reference.board.flush());
      t.eq(await p2.evaluate(async () => (await indexedDB.databases()).length), 0, 'nothing was written to the device');
      await p2.reload({ waitUntil: 'domcontentloaded' });
      await p2.waitForFunction(() => !!window.__sculpt, null, { timeout: 90_000 });
      await p2.waitForTimeout(800);
      t.eq(await count(p2), 0, 'and a reload loses it');
    } finally {
      await ctx.close();
    }
    t.ok(errors.length === 0, `no page errors with keeping off${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  },

  async refFile(page, base, t) {
    await openForInput(page, base);
    await openPanel(page);
    await addFiles(page, [{ name: 'one.png', mimeType: 'image/png', buffer: await png(page, 400, 300) }]);
    await addFiles(page, [{ name: 'two.png', mimeType: 'image/png', buffer: await png(page, 300, 400) }]);
    await cardAction(page, 1, 'ref-act-grey');
    await cardAction(page, 2, 'ref-act-mirror');
    await cardAction(page, 1, 'ref-act-place');
    await page.evaluate(() => {
      const { board } = window.__sculpt.reference;
      board.setPlace(board.list()[0].id, { x: 0.1, y: 0.2, w: 0.3 });
      board.setLook(board.list()[0].id, { blend: 'overlay', opacity: 0.6 });
    });
    await lock(page);

    const packed = async (include) =>
      page.evaluate(async (inc) => {
        const blob = await window.__sculpt.fileActions.packFile(inc);
        const bytes = await blob.arrayBuffer();
        const scene = await window.__sculpt.file.unpack(bytes);
        return { bytes: [...new Uint8Array(bytes)], refs: scene.references ? { n: scene.references.items.length, names: scene.references.items.map((i) => i.name), first: { inView: scene.references.items[0].inView, place: scene.references.items[0].place, blend: scene.references.items[0].blend, opacity: scene.references.items[0].opacity, camera: !!scene.references.items[0].camera } } : null };
      }, include);
    const withRefs = await packed(true);
    t.ok(withRefs.refs && withRefs.refs.n === 2, `Save file with Include references carries the two pictures (${JSON.stringify(withRefs.refs)})`);
    t.eq(withRefs.refs?.names.join(','), 'two,one', 'in order');
    t.ok(withRefs.refs?.first.inView && withRefs.refs.first.place?.w === 0.3 && withRefs.refs.first.blend === 'overlay' && withRefs.refs.first.opacity === 0.6 && withRefs.refs.first.camera, `with where the picture stands, its blend and the camera (${JSON.stringify(withRefs.refs?.first)})`);
    const without = await packed(false);
    t.eq(without.refs, null, 'with it off the file has none');
    const plain = await page.evaluate(async () => {
      const bytes = await window.__sculpt.file.pack();
      return !(await window.__sculpt.file.unpack(bytes)).references;
    });
    t.ok(plain, 'and the plain pack (what Save to library uses) never has them');

    // The File menu: the switch, on by default, and the real download.
    const item = async () => {
      await page.evaluate(() => window.__sculpt.fileMenu.chip.click());
      const got = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.file-menu--file .file-menu__item')];
        const row = rows.find((r) => r.textContent.includes('Include references'));
        return row ? { checked: row.getAttribute('aria-checked'), disabled: row.disabled } : null;
      });
      await page.keyboard.press('Escape');
      return got;
    };
    const menuRow = await item();
    t.ok(menuRow !== null && menuRow.checked === 'true' && !menuRow.disabled, `File has an Include references switch, on by default (${JSON.stringify(menuRow)})`);
    const download = async () => {
      await page.evaluate(() => window.__sculpt.fileMenu.chip.click());
      const [dl] = await Promise.all([
        page.waitForEvent('download'),
        page.evaluate(() => [...document.querySelectorAll('.file-menu--file .file-menu__item')].find((r) => r.textContent.startsWith('Save file')).click()),
      ]);
      const path = await dl.path();
      const bytes = (await import('node:fs')).readFileSync(path);
      return page.evaluate(async (b) => {
        const scene = await window.__sculpt.file.unpack(new Uint8Array(b).buffer);
        return scene.references ? scene.references.items.length : 0;
      }, [...bytes]);
    };
    t.eq(await download(), 2, 'File > Save file includes them');
    await page.evaluate(() => window.__sculpt.fileMenu.chip.click());
    await page.evaluate(() => [...document.querySelectorAll('.file-menu--file .file-menu__item')].find((r) => r.textContent.includes('Include references')).click());
    await page.keyboard.press('Escape');
    t.eq((await item())?.checked, 'false', 'the switch turns off');
    t.eq(await download(), 0, 'with the switch off it does not');
    await page.evaluate(() => window.__sculpt.fileMenu.chip.click());
    await page.evaluate(() => [...document.querySelectorAll('.file-menu--file .file-menu__item')].find((r) => r.textContent.includes('Include references')).click());
    await page.keyboard.press('Escape');

    // Open: a file's own pictures replace the board; a file without them leaves it empty.
    await page.evaluate(() => window.__sculpt.reference.board.clear());
    t.eq(await count(page), 0, 'the board is emptied');
    await page.evaluate((b) => window.__sculpt.file.open(new Uint8Array(b).buffer), withRefs.bytes);
    await page.waitForTimeout(500);
    const got = await board(page);
    t.eq(got.map((b) => b.name).join(','), 'two,one', 'opening the file brings its pictures');
    t.ok(got[0].grey && got[1].mirror, 'with how each was drawn');
    t.eq(await inViewNames(page), 'two', 'and the one that was in the view is in it');
    t.eq(await arrangingNow(page), false, 'locked');
    await page.evaluate((b) => window.__sculpt.file.open(new Uint8Array(b).buffer), without.bytes);
    await page.waitForTimeout(500);
    t.eq(await count(page), 0, 'opening a file saved without them leaves the board empty');
    t.eq(await inViewNames(page), '', 'and nothing in the view');
  },

  async refNoUpload(page, base, t) {
    await openForInput(page, base);
    await openPanel(page);
    const marker = 'REFMARK-' + Math.random().toString(36).slice(2, 10);
    // A picture with a distinct stretch of bytes: a JPEG's own, found again in anything that carries it.
    await addFiles(page, [{ name: `${marker}.png`, mimeType: 'image/png', buffer: await png(page, 600, 400, { left: '#33aa55', right: '#aa3355' }) }]);
    await cardAction(page, 1, 'ref-act-place');
    await page.evaluate(() => {
      const { board } = window.__sculpt.reference;
      board.setLook(board.list()[0].id, { blend: 'behind' });
      board.setPlace(board.list()[0].id, { x: 0, y: 0, w: 1 });
    }); // behind: the backdrop is up while the scene is saved
    await page.waitForTimeout(500);
    const refBytes = Buffer.from(await page.evaluate(async () => [...new Uint8Array(await window.__sculpt.reference.board.list()[0].blob.arrayBuffer())]));
    const slice = refBytes.subarray(Math.floor(refBytes.length / 3), Math.floor(refBytes.length / 3) + 48);
    t.ok(refBytes.length > 500, `the picture has bytes to look for (${refBytes.length})`);

    // The network: every request is kept, and the project routes answer as a server would.
    const seen = [];
    let n = 0;
    await page.route(
      (u) => /^\/(admin\/)?api\//.test(u.pathname) && !u.pathname.endsWith('/config'),
      async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        const body = req.postDataBuffer();
        seen.push({ method: req.method(), path: url.pathname + url.search, body: body ? Buffer.from(body) : null });
        const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
        if (/\/projects$/.test(url.pathname) && req.method() === 'POST') return json({ id: 'testproj', title: 'Sculpt test' });
        if (url.pathname.endsWith('/scene') && req.method() === 'POST' && !url.searchParams.has('upload')) return json({ uploadId: 'u1', partSize: 64 * 1024 * 1024 });
        if (url.pathname.endsWith('/scene') && req.method() === 'PUT') return json({ part: Number(url.searchParams.get('part')), etag: `e${++n}` });
        if (url.pathname.endsWith('/scene') && req.method() === 'POST') return json({ id: 'testproj', title: 'Sculpt test', mode: 'scene' });
        return json({ ok: true });
      },
    );
    await page.evaluate(() => window.__sculpt.fileMenu.setRole('owner', '', false));
    await page.evaluate(() => window.__sculpt.fileMenu.saveToLibrary());
    await page.waitForTimeout(800);
    const parts = seen.filter((r) => r.method === 'PUT' && r.path.includes('/scene?'));
    t.ok(parts.length >= 1, `Save to library uploaded the scene (${seen.map((r) => `${r.method} ${r.path.slice(0, 40)}`).join('; ')})`);
    const all = Buffer.concat(seen.map((r) => r.body ?? Buffer.alloc(0)));
    t.ok(all.length > 1000, `the requests carried bytes to look through (${all.length})`);
    t.ok(!all.includes(slice), 'no request carries the picture’s bytes');
    t.ok(!all.includes(Buffer.from(marker)), 'nor its name');
    t.ok(!seen.some((r) => /ref/i.test(r.path.replace(/\/projects\/|\/scene|\/thumb|testproj|upload|part/g, ''))), 'nor does any address name references');
    // The scene part, opened: no references block, in the container's header or after unpacking.
    const inspected = await page.evaluate(async (bytes) => {
      const buf = new Uint8Array(bytes).buffer;
      const scene = await window.__sculpt.file.unpack(buf);
      const raw = new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
      const head = new TextDecoder().decode(raw.subarray(8, 8 + new DataView(raw.buffer).getUint32(4, true)));
      return { refs: !!scene.references, header: head.includes('references'), size: raw.length };
    }, [...parts[0].body]);
    t.ok(!inspected.refs && !inspected.header, `the uploaded scene has no references block (${JSON.stringify(inspected)})`);
    // The thumbnail uploaded beside it has no backdrop in it.
    const thumb = seen.find((r) => r.path.endsWith('/thumb'));
    const green = await page.evaluate(async (bytes) => {
      const bmp = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      const x = c.getContext('2d');
      x.drawImage(bmp, 0, 0);
      // The corners of the picture: the view's background, where a backdrop would have been the picture's green and pink.
      const px = [x.getImageData(2, 2, 1, 1).data, x.getImageData(c.width - 3, c.height - 3, 1, 1).data];
      return px.map((d) => [d[0], d[1], d[2]]);
    }, [...(thumb?.body ?? [])]);
    t.ok(thumb && green.every(([r, g, b]) => !(g > r + 40 && g > b + 20) && !(r > g + 60 && b > g)), `the uploaded thumbnail has no backdrop in it (${JSON.stringify(green)})`);
    // The same for a thumbnail taken on screen now.
    const local = await page.evaluate(async () => {
      const blob = await window.__sculpt.viewer.captureThumbnail();
      const bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      const x = c.getContext('2d');
      x.drawImage(bmp, 0, 0);
      const d = x.getImageData(4, 4, 1, 1).data;
      return [d[0], d[1], d[2]];
    });
    t.ok(!(local[1] > local[0] + 40), `a thumbnail has no backdrop (${local})`);
    t.ok(await page.evaluate(() => window.__sculpt.reference.view.describe().behind), 'while the backdrop is still up on screen afterwards');
    // Keep on this device (the shelf) takes the scene alone too.
    const shelf = await page.evaluate(async () => {
      const entry = await window.__sculpt.fileActions.keepOnDevice();
      return !!entry.id;
    });
    t.ok(shelf, 'the device shelf copy is made');
  },

  async refPhone(page, base, t) {
    const ctx = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(String(e)));
    try {
      await p.addInitScript(() => {
        window.__bozzettoAdaptiveOff = true;
        try {
          localStorage.setItem('bozzetto-device-choice', 'keep');
        } catch {
          /* none */
        }
      });
      // Phones are not a target: the page only has to load and work without errors at phone width.
      await openForInput(p, base);
      await p.evaluate(() => document.querySelector('.panel--reference .panel__handle').click());
      await p.waitForTimeout(200);
      await addFiles(p, [{ name: 'a.png', mimeType: 'image/png', buffer: await png(p, 400, 300) }]);
      await cardAction(p, 1, 'ref-act-place');
      t.eq(await p.evaluate(() => window.__sculpt.reference.board.inView().length), 1, 'a picture can be put in the view at phone width');
      await p.click('.ref-arrange');
      await p.waitForTimeout(300);
      t.eq(await p.evaluate(() => window.__sculpt.reference.view.describe().arranging), false, 'and locked again');
    } finally {
      await ctx.close();
    }
    t.ok(errors.length === 0, `no page errors on the phone${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  },

  // A finger on a picture's row of buttons while arranging: the frame takes
  // the touch for its drags, and once cancelled every touch on it, the
  // buttons' included, so they did nothing on a touch screen (they were only
  // ever pressed with click() here). Real taps, through the browser's touch.
  async refTouchBar(page, base, t) {
    const ctx = await page.context().browser().newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
    const errors = [];
    try {
      const p = await ctx.newPage();
      p.on('pageerror', (e) => errors.push(String(e)));
      await openSculpt(p, base, '&q=low');
      await openPanel(p);
      await addFiles(p, [{ name: 'first.png', mimeType: 'image/png', buffer: await png(p, 400, 300) }]);
      await p.evaluate(() => {
        const { board } = window.__sculpt.reference;
        board.putInView(board.list()[0].id);
        board.setArranging(true);
      });
      await openPanel(p, false);
      await p.waitForSelector('.ref-frame .ref-frame__btn--flip', { timeout: 10_000 });
      await p.waitForTimeout(300);
      const state = () =>
        p.evaluate(() => {
          const { board, view } = window.__sculpt.reference;
          const i = board.list()[0];
          return { mirror: i.mirror, grey: i.grey, inView: board.inView().length, arranging: view.describe().arranging, look: !!document.querySelector('.ref-look') && document.querySelector('.ref-look').getClientRects().length > 0 };
        });
      const tap = async (sel) => {
        const at = await p.evaluate((s) => {
          const r = document.querySelector(s).getBoundingClientRect();
          return [r.left + r.width / 2, r.top + r.height / 2];
        }, sel);
        await p.touchscreen.tap(at[0], at[1]);
        await p.waitForTimeout(350);
      };
      const before = await state();
      await tap('.ref-frame .ref-frame__btn--flip');
      let s = await state();
      t.ok(!before.mirror && s.mirror, `a finger's tap on Flip mirrors the picture (${before.mirror} to ${s.mirror})`);
      await tap('.ref-frame .ref-frame__btn--look');
      s = await state();
      t.ok(s.look, 'a tap on Look opens its pop-up');
      await tap('.ref-look input[type=checkbox]');
      s = await state();
      t.ok(s.grey, 'and a tap on Greyscale in it turns the picture grey');
      await tap('.ref-frame .ref-frame__btn--lock');
      s = await state();
      t.ok(!s.arranging && s.inView === 1, 'a tap on Lock ends arranging, the picture still in the view');
      await p.evaluate(() => window.__sculpt.reference.board.setArranging(true));
      await p.waitForTimeout(300);
      await tap('.ref-frame .ref-frame__btn--remove');
      s = await state();
      t.eq(s.inView, 0, 'a tap on Remove takes it out of the view');
    } finally {
      await ctx.close();
    }
    t.ok(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  },
};
