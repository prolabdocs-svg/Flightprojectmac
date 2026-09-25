import { BuilderScreen } from './BuilderScreen';

// Liveries live inside the Workshop (UI spec §41); the 'paint' route opens it on the livery tab.
export function PaintScreen() {
  return <BuilderScreen initialTab="livery" />;
}
