// References (src/reference/): the Reference tab, the board of pictures, the Beside window and
// the picture Over the view, and where the pictures are kept.
//
// refBoard: the tab stands after Tool and before Render, the View and Edit menus name it, a
//   picture is added from the picker (no capture attribute), by paste (only while the panel is
//   open) and by drop, newest first; the row menu has its five actions; Delete asks first.
// refImport: a picture is scaled to 2048 on its long side, written as JPEG (PNG only with
//   transparency), and the metadata is gone: a JPEG carrying an EXIF GPS block comes out without it.
// refShow: Beside opens, moves by its title bar, zooms and closes; Over the view behind (the
//   backdrop) and in front (a film at an opacity); Mirror and Greyscale change what is drawn
//   in each; the View switch takes the over-the-view picture off.
// refInput: a pen stroke over a picture in front still sculpts and the picture never takes the
//   pointer; the beside window takes input only on itself; Tab hides the Beside window and keeps
//   the over-the-view picture.
// refKeep: pictures come back after a reload when keeping on the device is on, and are gone
//   when it is off; New sculpt starts with none; a library project's are found again by its id.
// refFile: Save file carries them with Include references on and not with it off; opening a
//   file brings its own pictures, and one without them an empty board.
// refNoUpload: Save to library sends the scene alone (the network is watched: no reference
//   bytes, no references block), and a thumbnail has no backdrop in it.
// refPhone: at 390 wide the tabs do not run into one another and the one-panel rule holds.
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

/** A pixel of the picture drawn in front (its own canvas), at a fraction of its width and height. */
const overPixel = (page, fx, fy) =>
  page.evaluate(
    ([fx, fy]) => {
      const c = document.querySelector('.ref-over canvas');
      if (!c) return null;
      return [...c.getContext('2d').getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data].slice(0, 3);
    },
    [fx, fy],
  );

/** The same for the picture in the Beside window. */
const besidePixel = (page, fx, fy) =>
  page.evaluate(
    ([fx, fy]) => {
      const c = document.querySelector('.ref-beside canvas');
      if (!c) return null;
      return [...c.getContext('2d').getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data].slice(0, 3);
    },
    [fx, fy],
  );

const visible = (page, sel) =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    return !!e && !e.hidden && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  }, sel);

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
    t.ok(menus.view.includes('Reference over the view'), 'the View menu has "Reference over the view"');
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

    // Drop: onto the view.
    {
      const bytes = [...(await png(page, 160, 90, { left: '#c0c020' }))];
      await page.evaluate((bytes) => {
        const dt = new DataTransfer();
        dt.items.add(new File([new Uint8Array(bytes)], 'dropped.png', { type: 'image/png' }));
        const target = window.__sculpt.viewer.captureCanvas;
        target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
        target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      }, bytes);
      await page.waitForFunction(() => window.__sculpt.reference.board.list().length === 4, null, { timeout: 10_000 });
      t.eq((await names(page))[0], 'dropped', 'a picture dropped on the view is added');
      t.ok(await visible(page, '.panel--reference'), 'and the Reference panel opens to show it');
    }

    // The row menu.
    await page.locator('.ref-card:nth-child(1) .row-more').click();
    const labels = await page.evaluate(() => [...document.querySelectorAll('.ref-card:nth-child(1) .row-menu .file-menu__item')].map((b) => b.textContent));
    t.eq(labels.join('|'), 'Show beside|Show over the view|Mirror|Greyscale|Delete', 'the row menu has its five actions');
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
    await page.setViewportSize({ width: 1280, height: 800 });
    await openForInput(page, base);
    await openPanel(page);
    await addFiles(page, [{ name: 'first.png', mimeType: 'image/png', buffer: await png(page, 400, 300) }]);
    t.ok(!(await visible(page, '.ref-beside')), 'no Beside window until a picture is put there');

    // Beside.
    await cardAction(page, 1, 'ref-act-beside');
    t.ok(await visible(page, '.ref-beside'), 'Show beside opens the window');
    t.ok(await page.evaluate(() => document.querySelector('.ref-beside').classList.contains('float-window')), 'it is the float window');
    await shot(page, 'beside');
    let red = await besidePixel(page, 0.2, 0.2);
    t.ok(isRed(red), `the window shows the picture (left is red: ${red})`);
    const r0 = await page.evaluate(() => document.querySelector('.ref-beside').getBoundingClientRect().toJSON());
    const bar = await page.evaluate(() => {
      const r = document.querySelector('.ref-beside .float-window__bar').getBoundingClientRect();
      return [r.left + 60, r.top + 18];
    });
    await page.mouse.move(bar[0], bar[1]);
    await page.mouse.down();
    await page.mouse.move(bar[0] + 160, bar[1] + 90, { steps: 8 });
    await page.mouse.up();
    const r1 = await page.evaluate(() => document.querySelector('.ref-beside').getBoundingClientRect().toJSON());
    t.ok(Math.abs(r1.left - r0.left - 160) < 3 && Math.abs(r1.top - r0.top - 90) < 3, `the title bar moves the window (${r0.left},${r0.top} to ${r1.left},${r1.top})`);
    // Zoom with the wheel; two fingers are tested on the phone.
    const z0 = Number(await page.evaluate(() => document.querySelector('.ref-beside').dataset.zoom));
    const f = await page.evaluate(() => {
      const r = document.querySelector('.ref-beside__frame').getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    });
    await page.mouse.move(f[0], f[1]);
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(100);
    const z1 = Number(await page.evaluate(() => document.querySelector('.ref-beside').dataset.zoom));
    t.ok(z1 > z0 * 1.3, `the wheel zooms the picture inside the window (${z0} to ${z1})`);
    await page.mouse.down();
    await page.mouse.move(f[0] + 40, f[1] + 20, { steps: 4 });
    await page.mouse.up();
    const rect2 = await page.evaluate(() => document.querySelector('.ref-beside').getBoundingClientRect().toJSON());
    t.ok(Math.abs(rect2.left - r1.left) < 1 && Math.abs(rect2.top - r1.top) < 1, 'a drag inside pans the picture and the window stays');
    await page.click('.ref-beside .float-window__close');
    await page.waitForTimeout(150);
    t.ok(!(await visible(page, '.ref-beside')), 'the close button closes it');
    t.eq(await page.evaluate(() => window.__sculpt.reference.board.getView().id), null, 'and nothing is on');

    // Only one picture is on at a time.
    await addFiles(page, [{ name: 'second.png', mimeType: 'image/png', buffer: await png(page, 300, 400) }]);
    await cardAction(page, 1, 'ref-act-beside');
    await cardAction(page, 2, 'ref-act-over');
    const d = await page.evaluate(() => window.__sculpt.reference.view.describe());
    t.ok(!d.beside && d.behind, `one picture is on at a time (${JSON.stringify(d)})`);

    // Over the view, behind: the backdrop. The first picture is on the second card now; put the 400x300 one on.
    await cardAction(page, 1, 'ref-act-over'); // the newest (300x400): turn it off
    await cardAction(page, 2, 'ref-act-over'); // first.png: on, behind
    await page.waitForTimeout(500);
    const dd = await page.evaluate(() => ({ ...window.__sculpt.reference.view.describe(), id: window.__sculpt.reference.board.shown()?.name }));
    t.ok(dd.behind && dd.id === 'first', `the picture is behind the model (${JSON.stringify(dd)})`);
    // The view is 1280x800: the picture fits the height (800 tall, 1067 wide, 107 in from each side).
    const left = [300, 700];
    const right = [980, 700];
    t.ok(isRed(await sample(page, ...left)) && isBlue(await sample(page, ...right)), 'behind: the left of the view is the picture’s red, the right its blue');
    const edge = await sample(page, 60, 700);
    t.ok(!isRed(edge) && !isBlue(edge), `fitted to the view's height: beyond the picture it is the background (${edge})`);
    await shot(page, 'behind');
    // Mirror swaps the sides.
    await cardAction(page, 2, 'ref-act-mirror');
    await page.waitForTimeout(500);
    t.ok(isBlue(await sample(page, ...left)) && isRed(await sample(page, ...right)), 'Mirror swaps left and right behind the model');
    // Greyscale takes the colour out.
    await cardAction(page, 2, 'ref-act-grey');
    await page.waitForTimeout(500);
    t.ok(isGrey(await sample(page, ...left)) && isGrey(await sample(page, ...right)), 'Greyscale takes the colour out behind the model');
    await cardAction(page, 2, 'ref-act-mirror');
    await cardAction(page, 2, 'ref-act-grey');
    await page.waitForTimeout(400);
    t.ok(isRed(await sample(page, ...left)), 'both undone, the picture is as it was');
    // The model is drawn in front of it: the middle of the view is the model, not the picture.
    const mid = await meshCentre(page);
    const midColour = await sample(page, mid[0], mid[1]);
    t.ok(!isRed(midColour) && !isBlue(midColour), `the model stands in front of a picture behind it (${midColour})`);

    // In front: a film at an opacity.
    await page.locator('.panel--reference .ref-over-settings .checkbox').click();
    await page.waitForTimeout(400);
    const front = await page.evaluate(() => window.__sculpt.reference.view.describe());
    t.ok(front.front && !front.behind, `the switch puts it in front (${JSON.stringify(front)})`);
    t.ok(isRed(await overPixel(page, 0.2, 0.2)) && isBlue(await overPixel(page, 0.8, 0.2)), 'in front: the picture is red on the left, blue on the right');
    const layout = await page.evaluate(() => {
      const c = document.querySelector('.ref-over canvas').getBoundingClientRect();
      const v = window.__sculpt.viewer.captureCanvas.getBoundingClientRect();
      return { ch: c.height, vh: v.height, cx: c.left + c.width / 2, vx: v.left + v.width / 2 };
    });
    t.ok(Math.abs(layout.ch - layout.vh) < 1 && Math.abs(layout.cx - layout.vx) < 1, `fitted to the view's height and centred (${JSON.stringify(layout)})`);
    // Opacity slider.
    await page.evaluate(() => {
      const s = document.querySelector('.panel--reference .ref-over-settings input[type=range]');
      s.value = '30';
      s.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(300);
    const op = await page.evaluate(() => getComputedStyle(document.querySelector('.ref-over')).opacity);
    t.near(Number(op), 0.3, 0.02, 'the Opacity slider sets how strongly it shows in front');
    await shot(page, 'front');
    await cardAction(page, 2, 'ref-act-mirror');
    t.ok(isBlue(await overPixel(page, 0.2, 0.2)) && isRed(await overPixel(page, 0.8, 0.2)), 'Mirror swaps the picture in front');
    await cardAction(page, 2, 'ref-act-grey');
    t.ok(isGrey(await overPixel(page, 0.2, 0.2)) && isGrey(await overPixel(page, 0.8, 0.2)), 'Greyscale takes the colour out in front');
    // And in the Beside window.
    await cardAction(page, 2, 'ref-act-beside');
    t.ok(isGrey(await besidePixel(page, 0.2, 0.2)) && isGrey(await besidePixel(page, 0.8, 0.2)) && !(await visible(page, '.ref-over')), 'Beside shows the same picture, mirrored and grey, and the film is away');
    await cardAction(page, 2, 'ref-act-over');

    // The View switch "Reference over the view" takes the picture off the view and back.
    await page.evaluate(() => window.__sculpt.reference.view.setOverEnabled(false));
    await page.waitForTimeout(300);
    t.ok(!(await visible(page, '.ref-over')), 'View > Reference over the view off: the film is away');
    await page.evaluate(() => window.__sculpt.reference.board.setOver({ front: false }));
    await page.waitForTimeout(300);
    t.ok(!(await page.evaluate(() => window.__sculpt.reference.view.describe().behind)), 'and the backdrop too');
    await page.evaluate(() => window.__sculpt.reference.view.setOverEnabled(true));
    await page.waitForTimeout(400);
    t.ok(await page.evaluate(() => window.__sculpt.reference.view.describe().behind), 'on again, it is back');
  },

  async refInput(page, base, t) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openForInput(page, base);
    await openPanel(page);
    await addFiles(page, [{ name: 'first.png', mimeType: 'image/png', buffer: await png(page, 400, 300) }]);
    await cardAction(page, 1, 'ref-act-over');
    await page.locator('.panel--reference .ref-over-settings .checkbox').click();
    await page.waitForTimeout(400);
    t.ok(await visible(page, '.ref-over'), 'a picture is in front of the view');
    // A pen stroke across the model, through the picture, as CDP sends a pen.
    const [cx, cy] = await meshCentre(page);
    const top = await page.evaluate(([x, y]) => {
      const e = document.elementFromPoint(x, y);
      return { overlay: !!e?.closest('.ref-over'), tag: e?.tagName, pe: getComputedStyle(document.querySelector('.ref-over')).pointerEvents };
    }, [cx, cy]);
    t.ok(!top.overlay && top.pe === 'none', `the picture takes no pointer: the element under the pen is not it (${JSON.stringify(top)})`);
    await page.keyboard.press('3');
    const strokes0 = await page.evaluate(() => window.__sculpt.input.strokeCount());
    const before = await meshSum(page);
    const cdp = await page.context().newCDPSession(page);
    const pen = (type, x, y, buttons) =>
      cdp.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1, pointerType: 'pen', force: 0.6 });
    await pen('mouseMoved', cx - 40, cy, 0);
    await pen('mousePressed', cx - 40, cy, 1);
    for (let i = 1; i <= 8; i++) await pen('mouseMoved', cx - 40 + i * 10, cy + i * 2, 1);
    await pen('mouseReleased', cx + 40, cy + 16, 0);
    await page.waitForTimeout(400);
    const after = await meshSum(page);
    const strokes1 = await page.evaluate(() => window.__sculpt.input.strokeCount());
    t.ok(after !== before, 'a Pencil stroke over a picture in front still sculpts: the mesh changed');
    t.eq(strokes1, strokes0 + 1, 'and it is one stroke, begun and ended');
    t.ok(await visible(page, '.ref-over'), 'the picture is still there');
    // Touch on the model goes to the model too: a finger orbits (a pointer the overlay never sees).
    const camBefore = await page.evaluate(() => window.__sculpt.viewer.camera.position.toArray());
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    await touch('touchStart', [{ x: 200, y: 600, id: 1 }]);
    for (let i = 1; i <= 8; i++) await touch('touchMove', [{ x: 200 + i * 12, y: 600, id: 1 }]);
    await touch('touchEnd', []);
    await page.waitForTimeout(300);
    const camAfter = await page.evaluate(() => window.__sculpt.viewer.camera.position.toArray());
    t.ok(camAfter.some((v, i) => Math.abs(v - camBefore[i]) > 1e-4), 'a finger drag on the view still orbits it through the picture');

    // The Beside window takes input only on itself: a stroke beside it still sculpts.
    await page.evaluate(() => {
      const b = window.__sculpt.reference.board;
      b.show(b.list()[0].id, 'beside');
    });
    await page.waitForTimeout(300);
    const win = await page.evaluate(() => document.querySelector('.ref-beside').getBoundingClientRect().toJSON());
    t.ok(win.right < cx - 120, `the window is at the corner, not over the model (${win.right} against ${cx})`);
    const b2 = await meshSum(page);
    await page.mouse.move(cx - 40, cy + 30);
    await page.mouse.down();
    await page.mouse.move(cx + 40, cy + 40, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    t.ok((await meshSum(page)) !== b2, 'with the window open the model is still sculpted');

    // Tab: the Beside window goes with the interface, the picture over the view stays.
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Tab'); // closes the open panel
    await page.waitForTimeout(250);
    await page.keyboard.press('Tab'); // hides the interface
    await page.waitForTimeout(500);
    t.ok(await page.evaluate(() => document.body.classList.contains('chrome-hidden')), 'Tab hides the interface');
    t.ok(!(await visible(page, '.ref-beside')), 'the Beside window is hidden with it');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);
    t.ok(await visible(page, '.ref-beside'), 'and comes back with it');
    await page.evaluate(() => {
      const b = window.__sculpt.reference.board;
      b.show(b.list()[0].id, 'over');
    });
    await page.waitForTimeout(300);
    t.ok(await visible(page, '.ref-over'), 'a picture over the view is up');
    await page.keyboard.press('Tab'); // no panel is open now: this one hides the interface
    await page.waitForTimeout(500);
    t.ok(await page.evaluate(() => document.body.classList.contains('chrome-hidden')), 'the interface is hidden again');
    t.ok(await visible(page, '.ref-over'), 'the picture over the view stays when the interface is hidden');
    await shot(page, 'chrome-hidden-over');
    await page.keyboard.press('Tab');
  },

  async refKeep(page, base, t) {
    await openForInput(page, base);
    await openPanel(page);
    await addFiles(page, [{ name: 'one.png', mimeType: 'image/png', buffer: await png(page, 400, 300) }]);
    await addFiles(page, [{ name: 'two.png', mimeType: 'image/png', buffer: await png(page, 300, 400) }]);
    await cardAction(page, 1, 'ref-act-mirror');
    await cardAction(page, 1, 'ref-act-beside');
    await page.evaluate(() => window.__sculpt.reference.board.flush());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__sculpt, null, { timeout: 90_000 });
    await page.waitForFunction(() => window.__sculpt.reference.board.list().length === 2, null, { timeout: 15_000 }).catch(() => {});
    const after = await board(page);
    t.eq(after.map((b) => b.name).join(','), 'two,one', 'a reload brings the pictures back, in the same order');
    t.ok(after[0].mirror && !after[1].mirror, 'with how each was drawn');
    await page.waitForTimeout(600);
    t.ok(await visible(page, '.ref-beside'), 'and the one that was on is on');

    // New sculpt starts with an empty board, and a reload after it has none.
    await page.evaluate(() => window.__sculpt.fileActions.newScene());
    await page.waitForTimeout(500);
    t.eq(await count(page), 0, 'New sculpt starts with an empty board');
    t.ok(!(await visible(page, '.ref-beside')), 'and nothing on');
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
    t.ok(!(await page.evaluate(() => document.querySelector('.ref-note').textContent.includes('never uploaded'))), 'a library project’s panel no longer says "never uploaded"');
    t.eq(await page.evaluate(() => document.querySelector('.ref-note').textContent), 'References stay on the device they were added on.', 'the panel says where they stay');
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
    await cardAction(page, 1, 'ref-act-beside');

    const packed = async (include) =>
      page.evaluate(async (inc) => {
        const blob = await window.__sculpt.fileActions.packFile(inc);
        const bytes = await blob.arrayBuffer();
        const scene = await window.__sculpt.file.unpack(bytes);
        return { bytes: [...new Uint8Array(bytes)], refs: scene.references ? { n: scene.references.items.length, names: scene.references.items.map((i) => i.name), view: scene.references.view } : null };
      }, include);
    const withRefs = await packed(true);
    t.ok(withRefs.refs && withRefs.refs.n === 2, `Save file with Include references carries the two pictures (${JSON.stringify(withRefs.refs)})`);
    t.eq(withRefs.refs?.names.join(','), 'two,one', 'in order');
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
    t.ok(await visible(page, '.ref-beside'), 'and the one that was on is on');
    await page.evaluate((b) => window.__sculpt.file.open(new Uint8Array(b).buffer), without.bytes);
    await page.waitForTimeout(500);
    t.eq(await count(page), 0, 'opening a file saved without them leaves the board empty');
    t.ok(!(await visible(page, '.ref-beside')), 'and nothing on');
  },

  async refNoUpload(page, base, t) {
    await openForInput(page, base);
    await openPanel(page);
    const marker = 'REFMARK-' + Math.random().toString(36).slice(2, 10);
    // A picture with a distinct stretch of bytes: a JPEG's own, found again in anything that carries it.
    await addFiles(page, [{ name: `${marker}.png`, mimeType: 'image/png', buffer: await png(page, 600, 400, { left: '#33aa55', right: '#aa3355' }) }]);
    await cardAction(page, 1, 'ref-act-over'); // behind: the backdrop is up while the scene is saved
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
      await openForInput(p, base);
      const rects = await p.evaluate(() =>
        [...document.querySelectorAll('.panel > .panel__handle')]
          .filter((e) => e.getClientRects().length > 0)
          .map((e) => ({ name: e.textContent.trim(), ...e.getBoundingClientRect().toJSON() })),
      );
      const overlap = rects.filter((a, i) => rects.some((b, j) => i !== j && a.left < b.right - 0.5 && b.left < a.right - 0.5));
      t.ok(rects.length >= 6 && overlap.length === 0, `at 390px the tabs do not run into one another (${rects.map((r) => `${r.name} ${Math.round(r.left)}-${Math.round(r.right)}`).join(', ')})`);
      t.ok(rects.every((r) => r.left >= 0 && r.right <= 390.5), 'and all are on the screen');
      await shot(p, 'phone-tabs');
      // One panel at a time: Reference closes the left panel, and Scene closes Reference.
      const open = () => p.evaluate(() => [...document.querySelectorAll('.panel:not(.panel--collapsed)')].map((e) => [...e.classList].find((c) => c.startsWith('panel--') && c !== 'panel--left')));
      await p.evaluate(() => document.querySelector('.panel--scene .panel__handle').click());
      await p.waitForTimeout(200);
      t.eq((await open()).join(','), 'panel--scene', 'Scene is open');
      await p.evaluate(() => document.querySelector('.panel--reference .panel__handle').click());
      await p.waitForTimeout(200);
      t.eq((await open()).join(','), 'panel--reference', 'opening Reference closes the Scene panel on a phone');
      await p.evaluate(() => document.querySelector('.panel--sculpt .panel__handle').click());
      await p.waitForTimeout(200);
      t.eq((await open()).join(','), 'panel--sculpt', 'and opening Tool closes Reference');
      await p.evaluate(() => document.querySelector('.panel--reference .panel__handle').click());
      await p.waitForTimeout(200);
      t.eq((await open()).join(','), 'panel--reference', 'Reference opens again');
      await addFiles(p, [{ name: 'a.png', mimeType: 'image/png', buffer: await png(p, 400, 300) }]);
      await addFiles(p, [{ name: 'b.png', mimeType: 'image/png', buffer: await png(p, 300, 400) }]);
      const grid = await p.evaluate(() => {
        const cards = [...document.querySelectorAll('.ref-card')].map((e) => e.getBoundingClientRect());
        const panel = document.querySelector('.panel--reference').getBoundingClientRect();
        return { n: cards.length, inside: cards.every((r) => r.left >= panel.left - 0.5 && r.right <= panel.right + 0.5), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
      t.ok(grid.n === 2 && grid.inside && grid.overflow === 0, `the grid fits the phone (${JSON.stringify(grid)})`);
      await shot(p, 'phone-board');
      await p.evaluate(() => {
        const b = window.__sculpt.reference.board;
        b.show(b.list()[0].id, 'beside');
      });
      await p.waitForTimeout(300);
      await shot(p, 'phone-beside');
      // Two fingers in the Beside window: pinch zooms, and the pair together pans.
      const cdp = await p.context().newCDPSession(p);
      const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
      const f = await p.evaluate(() => {
        const r = document.querySelector('.ref-beside__frame').getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      const zoom = () => p.evaluate(() => Number(document.querySelector('.ref-beside').dataset.zoom));
      const z0 = await zoom();
      await touch('touchStart', [{ x: f.x - 20, y: f.y, id: 1 }, { x: f.x + 20, y: f.y, id: 2 }]);
      for (let i = 1; i <= 8; i++) await touch('touchMove', [{ x: f.x - 20 - i * 6, y: f.y, id: 1 }, { x: f.x + 20 + i * 6, y: f.y, id: 2 }]);
      await touch('touchEnd', []);
      const z1 = await zoom();
      t.ok(z1 > z0 * 1.8, `pinching zooms the picture in the window (${z0} to ${z1})`);
      const t0 = await p.evaluate(() => document.querySelector('.ref-beside__picture').style.transform);
      await touch('touchStart', [{ x: f.x - 20, y: f.y, id: 1 }, { x: f.x + 20, y: f.y, id: 2 }]);
      for (let i = 1; i <= 6; i++) await touch('touchMove', [{ x: f.x - 20 + i * 4, y: f.y + i * 3, id: 1 }, { x: f.x + 20 + i * 4, y: f.y + i * 3, id: 2 }]);
      await touch('touchEnd', []);
      const t1 = await p.evaluate(() => document.querySelector('.ref-beside__picture').style.transform);
      const z2 = await zoom();
      t.ok(t1 !== t0 && Math.abs(z2 - z1) < 0.05, `two fingers together pan it without zooming (${t0} to ${t1})`);
      // One finger on the picture does not move it (and the window stays put).
      const win0 = await p.evaluate(() => document.querySelector('.ref-beside').getBoundingClientRect().toJSON());
      await touch('touchStart', [{ x: f.x, y: f.y, id: 1 }]);
      for (let i = 1; i <= 5; i++) await touch('touchMove', [{ x: f.x + i * 8, y: f.y, id: 1 }]);
      await touch('touchEnd', []);
      const t2 = await p.evaluate(() => document.querySelector('.ref-beside__picture').style.transform);
      const win1 = await p.evaluate(() => document.querySelector('.ref-beside').getBoundingClientRect().toJSON());
      t.ok(t2 === t1 && Math.abs(win1.left - win0.left) < 1, 'one finger moves nothing');
    } finally {
      await ctx.close();
    }
    t.ok(errors.length === 0, `no page errors on the phone${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  },
};
