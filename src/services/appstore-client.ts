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

    const response = await this.axiosInstance.request<ArrayBuffer>({
      method: 'GET',
      url,
      params,
      responseType: 'arraybuffer',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/a-gzip'
      }
    });

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