import { createElement } from 'react';
import { BoardVisual } from './BoardVisual';
import type { Scene } from './model';

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The board could not be rendered for export.'));
    image.src = url;
  });
}

export async function exportBoard(scene: Scene, width: 1920 | 3840 = 1920, name = 'Tactics Board') {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const height = width * 9 / 16;
  const markup = renderToStaticMarkup(createElement(BoardVisual, { scene, clean: true, width, height }));
  const vector = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = await loadImage(vector);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('PNG export is unavailable in this browser.');
    ctx.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(png => png ? resolve(png) : reject(new Error('The PNG could not be saved.')), 'image/png');
    });
    const file = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeName = name.replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 120) || 'Tactics Board';
    link.download = `${safeName} – ${width}×${height}.png`;
    link.href = file;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(file), 1500);
  } finally {
    URL.revokeObjectURL(vector);
  }
}
