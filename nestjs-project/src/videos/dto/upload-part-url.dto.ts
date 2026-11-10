export class UploadPartUrlDto {
  /** 1-based part number. */
  part_number: number;

  /** Presigned `PUT` URL for this part. */
  url: string;
}
