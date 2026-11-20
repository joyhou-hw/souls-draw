import { renderLifeScreen } from './screens/life.ts';
import { renderBoardScreen } from './screens/board.ts';

type ScreenId = 'life' | 'board';

const app = document.querySelector<HTMLElement>('#app');
const nav = document.querySelector<HTMLElement>('#nav');
const navButtons = nav?.querySelectorAll<HTMLButtonElement>('button') ?? [];

function show(screen: ScreenId): void {
  if (!app) return;
  for (const btn of navButtons) {
    btn.classList.toggle('active', btn.dataset.screen === screen);
  }
  app.replaceChildren();
  if (screen === 'life') renderLifeScreen(app);
  else renderBoardScreen(app);
}

for (const btn of navButtons) {
  btn.addEventListener('click', () => {
    const s = btn.dataset.screen;
    if (s === 'life' || s === 'board') show(s);
  });
}

show('life');
