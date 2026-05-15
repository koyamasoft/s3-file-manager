import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type Bucket,
  type _Object,
} from "@aws-sdk/client-s3";
import type { ToolConfig } from "./config.js";
import { contentTypeFor } from "./file.js";

export type ObjectMetadata = {
  key: string;
  etag?: string;
  contentType?: string;
  contentLength?: number;
  lastModified?: string;
};

export function createS3Client(config: ToolConfig): S3Client {
  return new S3Client({
    region: config.region,
    ...(config.endpoint && {
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
    }),
  });
}

export async function listObjects(
  client: S3Client,
  bucket: string,
  prefix: string,
): Promise<_Object[]> {
  const objects: _Object[] = [];
  let continuationToken: string | undefined;

  do {
    const result = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix || undefined,
      ContinuationToken: continuationToken,
    }));
    objects.push(...(result.Contents ?? []));
    continuationToken = result.NextContinuationToken;
  } while (continuationToken);

  return objects;
}

export async function listBuckets(client: S3Client): Promise<Bucket[]> {
  const result = await client.send(new ListBucketsCommand({}));
  return result.Buckets ?? [];
}

export async function createBucket(
  client: S3Client,
  bucket: string,
  region: string,
  isCustomEndpoint: boolean,
): Promise<void> {
  await client.send(new CreateBucketCommand({
    Bucket: bucket,
    ...(!isCustomEndpoint && region !== "us-east-1" && {
      CreateBucketConfiguration: {
        LocationConstraint: region as never,
      },
    }),
  }));
}

export async function headObject(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<ObjectMetadata> {
  const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  return {
    key,
    etag: result.ETag,
    contentType: result.ContentType,
    contentLength: result.ContentLength,
    lastModified: result.LastModified?.toISOString(),
  };
}

export async function downloadObject(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<{ body: Uint8Array; metadata: ObjectMetadata }> {
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!result.Body) throw new Error(`Object has no body: ${key}`);

  const body = await result.Body.transformToByteArray();
  return {
    body,
    metadata: {
      key,
      etag: result.ETag,
      contentType: result.ContentType,
      contentLength: result.ContentLength,
      lastModified: result.LastModified?.toISOString(),
    },
  };
}

export async function uploadObject(
  client: S3Client,
  bucket: string,
  key: string,
  body: Buffer,
  contentType?: string,
): Promise<void> {
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType ?? contentTypeFor(key),
  }));
}
