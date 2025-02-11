import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import fetch, { FetchError, HeadersInit } from 'node-fetch';
import logger from '../utils/logger';
import { RequestStatus } from './constants';
import { Request, Response } from './entities';
import { EntityRepository } from '@mikro-orm/postgresql';
import { InjectRepository } from '@mikro-orm/nestjs';
import { GetFeedRequestsCountInput, GetFeedRequestsInput } from './types';
import { deflate, inflate } from 'zlib';
import { promisify } from 'util';
import { ObjectFileStorageService } from '../object-file-storage/object-file-storage.service';
import { createHash, randomUUID } from 'crypto';
import { CacheStorageService } from '../cache-storage/cache-storage.service';
import { FeedTooLargeException } from './exceptions';
import iconv from 'iconv-lite';

const deflatePromise = promisify(deflate);
const inflatePromise = promisify(inflate);

const sha1 = createHash('sha1');

const trimHeadersForStorage = (obj?: HeadersInit) => {
  if (!obj) {
    return obj;
  }

  const newObj: HeadersInit = {};

  for (const key in obj) {
    if (obj[key]) {
      newObj[key] = obj[key];
    }
  }

  return newObj;
};

interface FetchOptions {
  userAgent?: string;
  headers?: HeadersInit;
}

@Injectable()
export class FeedFetcherService {
  defaultUserAgent: string;

  constructor(
    @InjectRepository(Request)
    private readonly requestRepo: EntityRepository<Request>,
    @InjectRepository(Response)
    private readonly responseRepo: EntityRepository<Response>,
    private readonly configService: ConfigService,
    private readonly objectFileStorageService: ObjectFileStorageService,
    private readonly cacheStorageService: CacheStorageService,
  ) {
    this.defaultUserAgent = this.configService.getOrThrow(
      'FEED_REQUESTS_FEED_REQUEST_DEFAULT_USER_AGENT',
    );
  }

  async getRequests({ skip, limit, url, select }: GetFeedRequestsInput) {
    return this.requestRepo
      .createQueryBuilder()
      .select(select || '*')
      .where({
        url,
      })
      .limit(limit)
      .offset(skip)
      .orderBy({
        createdAt: 'DESC',
      })
      .execute('all', true);
  }

  async countRequests({ url }: GetFeedRequestsCountInput) {
    return this.requestRepo.count({ url });
  }

  async getLatestRequestHeaders({
    url,
  }: {
    url: string;
  }): Promise<Response['headers']> {
    const request = await this.requestRepo.findOne(
      {
        url,
        status: RequestStatus.OK,
      },
      {
        orderBy: {
          createdAt: 'DESC',
        },
        populate: ['response'],
        fields: ['response.headers'],
      },
    );

    if (!request) {
      return {};
    }

    return request.response?.headers || {};
  }

  async getLatestRequest(url: string): Promise<{
    request: Request;
    decodedResponseText: string | null | undefined;
  } | null> {
    const request = await this.requestRepo.findOne(
      {
        url,
        response: {
          statusCode: {
            $ne: HttpStatus.NOT_MODIFIED,
          },
        },
      },
      {
        orderBy: {
          createdAt: 'DESC',
        },
        populate: [],
      },
    );

    if (!request) {
      return null;
    }

    let response: Response | null = null;

    if (request.response?.id) {
      response = await this.responseRepo.findOne({
        id: request.response.id,
      });
    }

    const cacheKey = response?.redisCacheKey;

    if (response && cacheKey) {
      const compressedText = await this.cacheStorageService.getFeedHtmlContent({
        key: cacheKey,
      });

      const text = compressedText
        ? (
            await inflatePromise(Buffer.from(compressedText, 'base64'))
          ).toString()
        : '';

      return {
        request: {
          ...request,
          response: {
            ...response,
          },
        },
        decodedResponseText: text,
      };
    }

    return { request, decodedResponseText: '' };
  }

  async fetchAndSaveResponse(
    url: string,
    options?: {
      flushEntities?: boolean;
      saveResponseToObjectStorage?: boolean;
      headers?: Record<string, string>;
    },
  ): Promise<{
    request: Request;
    responseText?: string | null;
  }> {
    const fetchOptions: FetchOptions = {
      userAgent: this.configService.get<string>('feedUserAgent'),
      headers: options?.headers,
    };
    const request = new Request();
    request.url = url;
    request.fetchOptions = {
      ...fetchOptions,
      headers: trimHeadersForStorage(fetchOptions.headers),
    };

    try {
      const res = await this.fetchFeedResponse(url, fetchOptions);

      if (res.ok || res.status === HttpStatus.NOT_MODIFIED) {
        request.status = RequestStatus.OK;
      } else {
        request.status = RequestStatus.BAD_STATUS_CODE;
      }

      const etag = res.headers.get('etag');
      const lastModified = res.headers.get('last-modified');

      const response = new Response();
      response.createdAt = request.createdAt;
      response.statusCode = res.status;
      response.headers = {};

      if (etag) {
        response.headers.etag = etag;
      }

      if (lastModified) {
        response.headers.lastModified = lastModified;
      }

      let text: string | null = null;

      try {
        text =
          res.status === HttpStatus.NOT_MODIFIED
            ? ''
            : await this.maybeDecodeResponse(res);

        const sizeOfTextInMb = Buffer.byteLength(text) / 1024 / 1024;

        // if (sizeOfTextInMb > 3) {
        //   throw new FeedTooLargeException(`Response body is too large`);
        // }

        try {
          const deflated = await deflatePromise(text);
          const compressedText = deflated.toString('base64');

          logger.datadog('saving response', {
            url,
            byteSize: Buffer.byteLength(compressedText),
          });

          if (options?.saveResponseToObjectStorage) {
            response.s3ObjectKey = randomUUID();

            try {
              await this.objectFileStorageService.uploadFeedHtmlContent({
                key: response.s3ObjectKey,
                body: compressedText,
              });
            } catch (err) {
              logger.error(
                `Failed to upload feed hmtl content to object file storage`,
                {
                  stack: (err as Error).stack,
                },
              );
            }
          }

          response.redisCacheKey = sha1.copy().update(url).digest('hex');
          response.textHash = text
            ? sha1.copy().update(text).digest('hex')
            : '';

          await this.cacheStorageService.setFeedHtmlContent({
            key: response.redisCacheKey,
            body: compressedText,
          });
        } catch (err) {
          if (err instanceof FeedTooLargeException) {
            throw err;
          }

          logger.error(
            `Failed to upload feed html content for url ${url} to cache`,
            {
              stack: (err as Error).stack,
            },
          );
        }
      } catch (err) {
        if (err instanceof FeedTooLargeException) {
          request.status = RequestStatus.REFUSED_LARGE_FEED;
        } else {
          request.status = RequestStatus.PARSE_ERROR;
          logger.debug(`Failed to parse response text of url ${url}`, {
            stack: (err as Error).stack,
          });
        }
      }

      const isCloudflareServer = !!res.headers
        .get('server')
        ?.includes('cloudflare');

      response.isCloudflare = isCloudflareServer;

      await this.responseRepo.persist(response);
      request.response = response;

      await this.requestRepo.persist(request);

      return {
        request,
        responseText: text,
      };
    } catch (err) {
      logger.debug(`Failed to fetch url ${url}`, {
        stack: (err as Error).stack,
      });

      if (err instanceof FetchError && err.type === 'request-timeout') {
        request.status = RequestStatus.FETCH_TIMEOUT;
        request.errorMessage = err.message;
      } else {
        request.status = RequestStatus.FETCH_ERROR;
        request.errorMessage = (err as Error).message;
      }

      await this.requestRepo.persist(request);

      return { request };
    } finally {
      if (options?.flushEntities) {
        await this.requestRepo.flush();
      }
    }
  }

  async fetchFeedResponse(
    url: string,
    options?: FetchOptions,
  ): Promise<ReturnType<typeof fetch>> {
    const res = await fetch(url, {
      timeout: 15000,
      follow: 5,
      headers: {
        ...options?.headers,
        'user-agent': options?.userAgent || this.defaultUserAgent,
      },
    });

    return res;
  }

  private async maybeDecodeResponse(
    res: Awaited<ReturnType<typeof fetch>>,
  ): Promise<string> {
    const charset = res.headers
      .get('content-type')
      ?.split(';')
      .find((s) => s.includes('charset'))
      ?.split('=')[1]
      .trim();

    if (!charset || /utf-*8/i.test(charset)) {
      return res.text();
    }

    const arrBuffer = await res.arrayBuffer();
    const decoded = iconv.decode(Buffer.from(arrBuffer), charset).toString();

    return decoded;
  }
}
