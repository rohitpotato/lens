import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export type StorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle?: boolean;
};

export type Storage = {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  presignGet(key: string, expiresSeconds?: number): Promise<string>;
  keyFor(hash: string, ext: string): string;
};

export function createStorage(cfg: StorageConfig): Storage {
  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
    forcePathStyle: cfg.forcePathStyle ?? true,
  });

  return {
    async put(key, body, contentType) {
      const input: PutObjectCommandInput = {
        Bucket: cfg.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      };
      await client.send(new PutObjectCommand(input));
    },
    async get(key) {
      const res = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
      const chunks: Buffer[] = [];
      const stream = res.Body as AsyncIterable<Uint8Array>;
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    },
    async presignGet(key, expiresSeconds = 300) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: cfg.bucket, Key: key }), {
        expiresIn: expiresSeconds,
      });
    },
    keyFor(hash, ext) {
      const now = new Date();
      const yyyy = now.getUTCFullYear();
      const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
      const cleanExt = ext.replace(/^\./, '').toLowerCase() || 'bin';
      return `documents/${yyyy}/${mm}/${hash}.${cleanExt}`;
    },
  };
}
