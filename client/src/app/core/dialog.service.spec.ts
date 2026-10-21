import { TestBed } from '@angular/core/testing';
import { DialogService } from './dialog.service';

describe('DialogService', () => {
  let svc: DialogService;
  beforeEach(() => {
    svc = TestBed.inject(DialogService);
  });

  it('resolves confirm with the chosen answer and clears the request', async () => {
    const p = svc.confirm({ title: 'Delete?', danger: true });
    expect(svc.current()?.title).toBe('Delete?');
    expect(svc.current()?.danger).toBe(true);
    expect(svc.current()?.confirmText).toBe('Confirm');
    svc.close(true);
    expect(await p).toBe(true);
    expect(svc.current()).toBeNull();
  });

  it('treats a dismissed confirm as false', async () => {
    const p = svc.confirm({ title: 'Delete?' });
    svc.close(false);
    expect(await p).toBe(false);
  });

  it('cancels an open dialog when another one opens', async () => {
    const first = svc.confirm({ title: 'One' });
    const second = svc.alert({ title: 'Two' });
    expect(await first).toBe(false);
    expect(svc.current()?.kind).toBe('alert');
    svc.close(false);
    await expect(second).resolves.toBeUndefined();
  });
});
