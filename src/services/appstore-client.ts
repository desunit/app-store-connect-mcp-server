import axios, { AxiosInstance } from 'axios';
import { gunzipSync } from 'node:zlib';
import { AuthService } from './auth.js';
import { AppStoreConnectConfig } from '../types/index.js';

export class AppStoreConnectClient {
  private axiosInstance: AxiosInstance;
  private authService: AuthService;

  constructor(config: AppStoreConnectConfig) {
    this.authService = new AuthService(config);
    this.authService.validateConfig();
    
    this.axiosInstance = axios.create({
      baseURL: 'https://api.appstoreconnect.apple.com/v1',
    });
  }

  async request<T = any>(method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH', url: string, data?: any, params?: Record<string, any>): Promise<T> {
    const token = await this.authService.generateToken();
    
    const response = await this.axiosInstance.request<T>({
      method,
      url,
      data,
      params,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    return response.data;
  }

  async get<T = any>(url: string, params?: Record<string, any>): Promise<T> {
    return this.request<T>('GET', url, undefined, params);
  }

  /**
   * GET a paged collection and follow `links.next` until exhausted.
   *
   * Apple caps `limit` at 200 per page and returns the rest behind a cursor.
   * A single `get()` therefore silently drops records whenever
   * `meta.paging.total` exceeds the page size — e.g. an analytics report
   * request exposes ~156 reports, so the old default of `limit=100` returned
   * 100 and hid 56 with no error. That looks identical to "the API doesn't
   * have it" and is how capabilities get wrongly written off.
   *
   * `links.next` is an absolute URL that already carries the cursor + limit,
   * so it is passed as `url` with NO extra params (axios ignores `baseURL`
   * for absolute URLs; re-sending `params` would duplicate the query string).
   *
   * `meta.paging.returned` / `pagesFetched` / `truncated` are added so a
   * caller can always tell a complete result from a capped one.
   */
  async getAllPages<T = any>(url: string, params?: Record<string, any>, maxPages = 50): Promise<T> {
    const first = await this.request<any>('GET', url, undefined, params);

    // Not a collection response — hand it back untouched.
    if (!Array.isArray(first?.data)) return first as T;

    const merged: any[] = [...first.data];
    let next: string | undefined = first.links?.next;
    let pagesFetched = 1;

    while (next && pagesFetched < maxPages) {
      const page = await this.request<any>('GET', next);
      if (!Array.isArray(page?.data)) break;
      merged.push(...page.data);
      next = page.links?.next;
      pagesFetched++;
    }

    return {
      ...first,
      data: merged,
      links: { self: first.links?.self },
      meta: {
        ...(first.meta ?? {}),
        paging: {
          ...(first.meta?.paging ?? {}),
          returned: merged.length,
          pagesFetched,
          truncated: Boolean(next)
        }
      }
    } as T;
  }

  async post<T = any>(url: string, data: any): Promise<T> {
    return this.request<T>('POST', url, data);
  }

  async put<T = any>(url: string, data: any): Promise<T> {
    return this.request<T>('PUT', url, data);
  }

  async delete<T = any>(url: string, data?: any): Promise<T> {
    return this.request<T>('DELETE', url, data);
  }

  async patch<T = any>(url: string, data: any): Promise<T> {
    return this.request<T>('PATCH', url, data);
  }

  /**
   * Download a Sales/Finance report. These endpoints return the report as a
   * gzipped TSV *body* (Accept: application/a-gzip), not transport-encoded gzip,
   * so it must be fetched as binary and gunzipped explicitly.
   */
  async getGzipReport(url: string, params?: Record<string, any>): Promise<{ data: string }> {
    const token = await this.authService.generateToken();

    let response;
    try {
      response = await this.axiosInstance.request<ArrayBuffer>({
        method: 'GET',
        url,
        params,
        responseType: 'arraybuffer',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/a-gzip'
        }
      });
    } catch (error) {
      // On a non-2xx, Apple returns a JSON error body (uncompressed) explaining
      // the cause — bad vendor number, no report for that date/region, key lacks
      // Finance/Sales access, etc. But because we asked for `arraybuffer`, that
      // body arrives as binary, so the generic handler's `error.response.data
      // .errors[0].detail` lookup misses it and only "status code 400" surfaces.
      // Decode it here and re-throw the real message.
      if (axios.isAxiosError(error) && error.response?.data) {
        const ebuf = Buffer.from(error.response.data as ArrayBuffer);
        const body = (ebuf[0] === 0x1f && ebuf[1] === 0x8b)
          ? gunzipSync(ebuf).toString('utf-8')
          : ebuf.toString('utf-8');
        let detail = body;
        try {
          const json = JSON.parse(body);
          detail = (json?.errors ?? [])
            .map((e: any) => [e.title, e.detail].filter(Boolean).join(': '))
            .filter(Boolean)
            .join(' | ') || body;
        } catch { /* not JSON — keep the raw body */ }
        throw new Error(`App Store Connect report error (HTTP ${error.response.status}): ${detail}`);
      }
      throw error;
    }

    const buf = Buffer.from(response.data);
    // The body is gzip (magic bytes 0x1f 0x8b). Guard in case Apple ever
    // returns an uncompressed error payload.
    const text = (buf[0] === 0x1f && buf[1] === 0x8b)
      ? gunzipSync(buf).toString('utf-8')
      : buf.toString('utf-8');

    return { data: text };
  }

  /**
   * Download an analytics report segment. The segment `url` is a pre-signed S3
   * URL (it already carries `X-Amz-Signature`/`X-Amz-Credential` query params),
   * so we must NOT attach an `Authorization` header — S3 rejects requests that
   * present two auth mechanisms with 400 Bad Request. The body is a gzipped CSV
   * (`.csv.gz`), so fetch it as binary and gunzip it explicitly.
   */
  async downloadFromUrl(url: string): Promise<any> {
    const response = await axios.get(url, {
      responseType: 'arraybuffer'
    });

    const buf = Buffer.from(response.data);
    // Gunzip when the body is gzip (magic bytes 0x1f 0x8b); fall back to raw
    // text otherwise (e.g. an uncompressed error payload).
    const data = (buf[0] === 0x1f && buf[1] === 0x8b)
      ? gunzipSync(buf).toString('utf-8')
      : buf.toString('utf-8');

    return {
      data,
      contentType: response.headers['content-type'],
      size: response.headers['content-length'] ?? String(buf.length)
    };
  }
}