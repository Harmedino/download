import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/home/home').then((m) => m.Home), title: 'SnapGrab: download public social media posts' },
  { path: 'result', loadComponent: () => import('./pages/result/result').then((m) => m.Result), title: 'Your download · SnapGrab' },
  { path: 'remove-bg', loadComponent: () => import('./pages/remove-bg/remove-bg').then((m) => m.RemoveBg), title: 'Remove background · SnapGrab' },
  // Background removal is images only; keep old video links working.
  { path: 'remove-bg/video', redirectTo: 'remove-bg' },
  { path: 'tools', loadComponent: () => import('./pages/tools/tools').then((m) => m.Tools), title: 'All tools · SnapGrab' },
  { path: 'convert', loadComponent: () => import('./pages/convert/convert').then((m) => m.Convert), title: 'Video converter · SnapGrab' },
  { path: 'compress', loadComponent: () => import('./pages/compress/compress').then((m) => m.Compress), title: 'Video compressor · SnapGrab' },
  { path: 'history', loadComponent: () => import('./pages/history/history').then((m) => m.History), title: 'History · SnapGrab' },
  { path: 'terms', loadComponent: () => import('./pages/terms/terms').then((m) => m.Terms), title: 'Terms of Use · SnapGrab' },
  { path: '**', loadComponent: () => import('./pages/not-found/not-found').then((m) => m.NotFound), title: 'Not found · SnapGrab' },
];
