import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../environments/environment';
import { clientId, clientIdInterceptor } from './client-id';

describe('clientIdInterceptor', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(withInterceptors([clientIdInterceptor])), provideHttpClientTesting()] });
  });

  it('keeps one random id per browser', () => {
    const id = clientId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(clientId()).toBe(id);
  });

  it('sends the id to our API only', () => {
    const http = TestBed.inject(HttpClient);
    const ctrl = TestBed.inject(HttpTestingController);
    http.get(`${environment.apiBaseUrl}/api/history`).subscribe();
    http.get('https://example.com/api/history').subscribe();
    expect(ctrl.expectOne(`${environment.apiBaseUrl}/api/history`).request.headers.get('X-Client-Id')).toBe(clientId());
    expect(ctrl.expectOne('https://example.com/api/history').request.headers.has('X-Client-Id')).toBe(false);
  });
});
