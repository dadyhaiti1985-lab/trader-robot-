import multer from 'multer';

const IMAGE_SIGNATURES = [
	{
		mime: 'image/jpeg',
		matches: buffer => buffer.length >= 3
			&& buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF,
	},
	{
		mime: 'image/png',
		matches: buffer => buffer.length >= 8
			&& buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47
			&& buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A,
	},
	{
		mime: 'image/webp',
		matches: buffer => buffer.length >= 12
			&& buffer.toString('ascii', 0, 4) === 'RIFF'
			&& buffer.toString('ascii', 8, 12) === 'WEBP',
	},
];

const detectImageMime = buffer => IMAGE_SIGNATURES.find(sig => sig.matches(buffer))?.mime ?? null;

export const uploadFiles = ({
	maxCount = 5,
	maxSizeMB = 20,
	maxTotalSizeMB = 20,
	maxFieldSizeBytes = 256 * 1024,
	allowedMimeTypes,
	fieldName,
}) => {
	const upload = multer({
		storage: multer.memoryStorage(),
		limits: {
			fileSize: maxSizeMB * 1024 * 1024,
			fieldSize: maxFieldSizeBytes,
		},
		fileFilter: (req, file, cb) => {
			if (allowedMimeTypes.includes(file.mimetype)) {
				cb(null, true);
			} else {
				cb(new Error(`Invalid file type. Only ${allowedMimeTypes.join(', ')} are allowed.`));
			}
		},
	});

	const runMulter = upload.array(fieldName, maxCount);

	return (req, res, next) => {
		runMulter(req, res, (err) => {
			if (err) {
				next(err);
				return;
			}

			try {
				validateFileContents({ files: req.files, allowedMimeTypes });
				validateTotalUploadSize({ files: req.files, maxTotalSizeBytes: maxTotalSizeMB * 1024 * 1024 });
				next();
			} catch (validationError) {
				next(validationError);
			}
		});
	};
};

function validateFileContents({ files, allowedMimeTypes }) {
	for (const file of files ?? []) {
		const detectedMime = detectImageMime(file.buffer);

		if (!detectedMime || !allowedMimeTypes.includes(detectedMime)) {
			throw new Error(`Invalid file content. Only ${allowedMimeTypes.join(', ')} are allowed.`);
		}
	}
}

/**
 * Enforces a strict total upload size limit per request.
 */
function validateTotalUploadSize({ files, maxTotalSizeBytes }) {
	const totalBytes = (files ?? []).reduce((sum, file) => sum + Number(file?.size || 0), 0);
	if (totalBytes > maxTotalSizeBytes) {
		throw new Error(`Total upload size exceeds ${Math.floor(maxTotalSizeBytes / (1024 * 1024))}MB.`);
	}
}
