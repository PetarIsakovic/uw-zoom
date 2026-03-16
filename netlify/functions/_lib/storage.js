import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { HttpError } from "./http.js";

const FALLBACK_MAX_UPLOAD_MB = 15;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const EXTENSIONS_BY_TYPE = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

let cachedClient;

export function storageConfigured() {
  return Boolean(resolveStorageRegion() && process.env.UWZ_S3_BUCKET);
}

export function getStorageConfig() {
  const maxUploadMb = Number(process.env.UWZ_MAX_UPLOAD_MB || FALLBACK_MAX_UPLOAD_MB);

  return {
    region: resolveStorageRegion(),
    bucket: process.env.UWZ_S3_BUCKET,
    maxUploadMb: Number.isFinite(maxUploadMb) && maxUploadMb > 0 ? maxUploadMb : FALLBACK_MAX_UPLOAD_MB,
  };
}

export function requireStorage() {
  const config = getStorageConfig();

  if (!config.region || !config.bucket) {
    throw new HttpError(
      503,
      "AWS storage is not configured. Add UWZ_AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and UWZ_S3_BUCKET in Netlify.",
    );
  }

  return config;
}

export function validateImageType(fileType) {
  if (!ALLOWED_IMAGE_TYPES.has(fileType)) {
    throw new HttpError(400, "Only JPEG, PNG, or WebP images are supported.");
  }
}

export function validateImageSize(fileSize) {
  const { maxUploadMb } = getStorageConfig();
  const bytes = Number(fileSize);

  if (!Number.isFinite(bytes) || bytes <= 0) {
    throw new HttpError(400, "A valid image size is required.");
  }

  if (bytes > maxUploadMb * 1024 * 1024) {
    throw new HttpError(400, `Keep uploads under ${maxUploadMb} MB.`);
  }
}

export async function createPresignedUpload({ filename, fileType }) {
  const { bucket } = requireStorage();
  validateImageType(fileType);

  const id = randomUUID();
  const imageKey = `pending/images/${id}${resolveExtension(filename, fileType)}`;
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: imageKey,
    ContentType: fileType,
  });

  const uploadUrl = await getSignedUrl(getClient(), command, {
    expiresIn: 300,
  });

  return {
    id,
    imageKey,
    uploadUrl,
  };
}

export function pendingMetadataKey(id) {
  return `pending/meta/${id}.json`;
}

export function approvedMetadataKey(id) {
  return `approved/meta/${id}.json`;
}

export async function objectExists(key) {
  const { bucket } = requireStorage();

  try {
    await getClient().send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );

    return true;
  } catch (error) {
    if (
      error?.$metadata?.httpStatusCode === 404 ||
      error?.name === "NotFound" ||
      error?.name === "NoSuchKey"
    ) {
      return false;
    }

    throw error;
  }
}

export async function putJson(key, value) {
  const { bucket } = requireStorage();

  await getClient().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(value, null, 2),
      ContentType: "application/json; charset=utf-8",
    }),
  );
}

export async function getJson(key) {
  const { bucket } = requireStorage();

  try {
    const response = await getClient().send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );

    const text = await streamToString(response.Body);
    return JSON.parse(text);
  } catch (error) {
    if (
      error?.$metadata?.httpStatusCode === 404 ||
      error?.name === "NoSuchKey" ||
      error?.name === "NotFound"
    ) {
      return null;
    }

    throw error;
  }
}

export async function listJson(prefix) {
  const { bucket } = requireStorage();
  const keys = [];
  let continuationToken;

  do {
    const response = await getClient().send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    keys.push(...(response.Contents || []).map((item) => item.Key).filter(Boolean));
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  const documents = await Promise.all(keys.map((key) => getJson(key)));

  return documents
    .filter(Boolean)
    .sort(
      (left, right) =>
        new Date(right.submittedAt || right.approvedAt || 0).getTime() -
        new Date(left.submittedAt || left.approvedAt || 0).getTime(),
    );
}

export async function createSignedDownloadUrl(key, expiresIn = 3600) {
  const { bucket } = requireStorage();

  return getSignedUrl(
    getClient(),
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
    { expiresIn },
  );
}

export async function copyObject(sourceKey, destinationKey) {
  const { bucket } = requireStorage();

  await getClient().send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: destinationKey,
      CopySource: buildCopySource(bucket, sourceKey),
    }),
  );
}

export async function deleteObject(key) {
  const { bucket } = requireStorage();

  await getClient().send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );
}

export function toApprovedImageKey(id, originalKey) {
  const extension = extname(originalKey) || ".jpg";
  return `approved/images/${id}${extension}`;
}

function getClient() {
  if (!cachedClient) {
    const { region } = requireStorage();
    cachedClient = new S3Client({ region });
  }

  return cachedClient;
}

function resolveExtension(filename, fileType) {
  const discovered = extname(String(filename || "")).toLowerCase();

  if (discovered && Object.values(EXTENSIONS_BY_TYPE).includes(discovered)) {
    return discovered;
  }

  return EXTENSIONS_BY_TYPE[fileType] || ".jpg";
}

function buildCopySource(bucket, key) {
  return `${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function resolveStorageRegion() {
  return process.env.UWZ_AWS_REGION || process.env.AWS_REGION || "";
}

async function streamToString(stream) {
  if (!stream) {
    return "";
  }

  if (typeof stream.transformToString === "function") {
    return stream.transformToString();
  }

  const chunks = [];

  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}
