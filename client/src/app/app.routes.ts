import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/home/home').then((m) => m.Home), title: 'SnapGrab: download public social media posts' },
  { path: 'result', loadComponent: () => import('./pages/result/result').then((m) => m.Result), title: 'Your download · SnapGrab' },
  { path: 'remove-bg', loadComponent: () => import('./pages/remove-bg/remove-bg').then((m) => m.RemoveBg), title: 'Remove background · SnapGrab' },
  { path: 'remove-bg/video', loadComponent: () => import('./pages/remove-bg-video/remove-bg-video').then((m) => m.RemoveBgVideo), title: 'Remove video background · SnapGrab' },
  { path: 'terms', loadComponent: () => import('./pages/terms/terms').then((m) => m.Terms), title: 'Terms of Use · SnapGrab' },
  { path: '**', loadComponent: () => import('./pages/not-found/not-found').then((m) => m.NotFound), title: 'Not found · SnapGrab' },
];
