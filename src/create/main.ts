import { initTheme } from '../ui/theme';
import { installRangeFill } from '../ui/rangeFill';
import { followPanelOpacity } from '../ui/appearance';
import { installSliderBubble } from '../ui/sliderBubble';
import { checkSignIn, roleOf, type SignIn } from '../admin/api';
import { mountWorkspace } from '../present/workspace';

/**
 * `/create/` (the gallery's Create > Create timelapse): the Present
 * workspace with no project yet, opened on its Frames tab, empty. Drop a
 * sculpt sequence there, set up the look in the real viewer, and keep it.
 * Frames are converted in the browser and held in memory; nothing is
 * uploaded until Save (present/workspace.ts has the rest).
 *
 * For a guest it is backend-free: nothing is uploaded, saved, or gated;
 * the reel's GIF and MP4 are what it makes, and Sign in (with accounts on)
 * turns the page into a signed-in one without losing the frames. Signed in
 * (a member, a moderator or the owner) Save makes a project on the
 * account's own routes (Projects, on the owner tools', with accounts off):
 * its title, mode and fps, the frames uploaded, the stages and the look as
 * its data, and a 4:5 picture - and opens My projects, where it is viewed
 * and shared. Who may use the page is as it was: anyone. The owner's
 * frame editor is the same workspace, at /?tl=<id>&present=1&tab=frames.
 */

/** Where a save goes for this sign-in, or null for a guest (suspended or expired: a guest's page). */
const placeOf = (s: SignIn): string | null => {
  const role = roleOf(s);
  return role === 'owner' || role === 'moderator' || role === 'member' ? (s.accounts ? 'My projects' : 'Projects') : null;
};

async function main(): Promise<void> {
  initTheme();
  followPanelOpacity();
  installRangeFill();
  installSliderBubble();
  const viewport = document.getElementById('viewport');
  if (!viewport) throw new Error('#viewport element not found');

  const guest = (): SignIn => ({ email: null, expired: false });
  const signIn = await checkSignIn().catch(guest);
  await mountWorkspace({
    viewport,
    tab: 'frames',
    create: {
      place: placeOf(signIn),
      accounts: signIn.accounts === true,
      recheck: async () => placeOf(await checkSignIn().catch(guest)),
    },
  });
}

void main();
