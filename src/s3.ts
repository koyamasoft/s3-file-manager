import {
  CopyObjectCommand,
  CreateBucketCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  GetBucketLocationCommand,
  type GetBucketLocationCommandOutput,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  ListBucketsCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
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
    ...(!config.endpoint && {
      followRegionRedirects: true,
    }),
    ...(config.endpoint && {
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
    }),
  });
}

function normalizeBucketRegion(region: GetBucketLocationCommandOutput["LocationConstraint"]): string {
  if (!region) return "us-east-1";
  if (region === "EU") return "eu-west-1";
  return String(region);
}

type BucketRegionError = {
  name?: string;
  Code?: string;
  Region?: string;
  region?: string;
  BucketRegion?: string;
  $metadata?: {
    httpHeaders?: Record<string, string | undefined>;
  };
  message?: string;
};

type S3Command = object;

export function bucketRegionFromError(error: unknown): string | undefined {
  const s3Error = error as BucketRegionError;
  const headers = s3Error.$metadata?.httpHeaders ?? {};
  const headerRegion = headers["x-amz-bucket-region"] ?? headers["X-Amz-Bucket-Region"];
  const region = headerRegion ?? s3Error.Region ?? s3Error.region ?? s3Error.BucketRegion;
  if (typeof region === "string" && region.trim()) return region.trim();
  return undefined;
}

function isBucketRegionRedirect(error: unknown): boolean {
  const s3Error = error as BucketRegionError;
  return s3Error.name === "PermanentRedirect" ||
    s3Error.Code === "PermanentRedirect" ||
    s3Error.name === "AuthorizationHeaderMalformed" ||
    s3Error.Code === "AuthorizationHeaderMalformed" ||
    s3Error.message?.includes("must be addressed using the specified endpoint") === true;
}

function hasCustomEndpoint(client: S3Client): boolean {
  return !!(client.config as { endpoint?: unknown }).endpoint;
}

async function sendBucketCommand<T>(
  client: S3Client,
  command: S3Command,
  makeCommand: () => S3Command,
): Promise<T> {
  try {
    return await client.send(command as never) as T;
  } catch (error) {
    const region = bucketRegionFromError(error);
    if (hasCustomEndpoint(client) || !region || !isBucketRegionRedirect(error)) throw error;

    const retryClient = new S3Client({
      region,
      followRegionRedirects: true,
    });
    try {
      return await retryClient.send(makeCommand() as never) as T;
    } finally {
      retryClient.destroy();
    }
  }
}

export async function listObjects(
  client: S3Client,
  bucket: string,
  prefix: string,
  limit = DEFAULT_LIST_OBJECT_LIMIT,
  continuationToken?: string,
): Promise<ListObjectsResult> {
  const input = {
    Bucket: bucket,
    Prefix: prefix || undefined,
    ContinuationToken: continuationToken,
    MaxKeys: Math.min(Math.max(limit, 1), 1_000),
  };
  const result = await sendBucketCommand<ListObjectsV2CommandOutput>(
    client,
    new ListObjectsV2Command(input),
    () => new ListObjectsV2Command(input),
  );

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

export async function getBucketRegion(client: S3Client, bucket: string): Promise<string> {
  const input = { Bucket: bucket };
  const result = await sendBucketCommand<GetBucketLocationCommandOutput>(
    client,
    new GetBucketLocationCommand(input),
    () => new GetBucketLocationCommand(input),
  );
  return normalizeBucketRegion(result.LocationConstraint);
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
  const input = { Bucket: bucket, Key: key };
  const result = await sendBucketCommand<HeadObjectCommandOutput>(
    client,
    new HeadObjectCommand(input),
    () => new HeadObjectCommand(input),
  );
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
  const input = { Bucket: bucket, Key: key };
  const result = await sendBucketCommand<GetObjectCommandOutput>(
    client,
    new GetObjectCommand(input),
    () => new GetObjectCommand(input),
  );
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
  const input = { Bucket: bucket, Key: key };
  const result = await sendBucketCommand<GetObjectCommandOutput>(
    client,
    new GetObjectCommand(input),
    () => new GetObjectCommand(input),
  );
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
  const input = {
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType ?? contentTypeFor(key),
  };
  await sendBucketCommand(
    client,
    new PutObjectCommand(input),
    () => new PutObjectCommand(input),
  );
}

export async function copyObject(
  client: S3Client,
  bucket: string,
  sourceKey: string,
  targetKey: string,
): Promise<void> {
  const copySource = `${bucket}/${sourceKey.split("/").map(encodeURIComponent).join("/")}`;
  const input = {
    Bucket: bucket,
    Key: targetKey,
    CopySource: copySource,
  };
  await sendBucketCommand(
    client,
    new CopyObjectCommand(input),
    () => new CopyObjectCommand(input),
  );
}
