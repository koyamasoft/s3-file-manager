import {
  CopyObjectCommand,
  CreateBucketCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
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

export const DEFAULT_LIST_OBJECT_LIMIT = 1_000;

export type ObjectMetadata = {
  key: string;
  etag?: string;
  contentType?: string;
  contentLength?: number;
  lastModified?: string;
};

export type ListObjectsResult = {
  objects: _Object[];
  isTruncated: boolean;
  nextContinuationToken?: string;
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
  limit = DEFAULT_LIST_OBJECT_LIMIT,
  continuationToken?: string,
): Promise<ListObjectsResult> {
  const result = await client.send(new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: prefix || undefined,
    ContinuationToken: continuationToken,
    MaxKeys: Math.min(Math.max(limit, 1), 1_000),
  }));

  return {
    objects: result.Contents ?? [],
    isTruncated: !!result.NextContinuationToken,
    nextContinuationToken: result.NextContinuationToken,
  };
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

export async function getObjectForDownload(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<GetObjectCommandOutput> {
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!result.Body) throw new Error(`Object has no body: ${key}`);
  return result;
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

export async function copyObject(
  client: S3Client,
  bucket: string,
  sourceKey: string,
  targetKey: string,
): Promise<void> {
  const copySource = `${bucket}/${sourceKey.split("/").map(encodeURIComponent).join("/")}`;
  await client.send(new CopyObjectCommand({
    Bucket: bucket,
    Key: targetKey,
    CopySource: copySource,
  }));
}
