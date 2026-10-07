import {
  SHOWER_CONFIGURATIONS,
  SHOWER_GEOMETRIES,
  isShowerConfigurationCompatible
} from '../_shared/photo-geometry.mjs';

const allowedOrigins = new Set([
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'http://localhost:8765',
  'http://127.0.0.1:8765',
  'https://brunos-glass-mirror-staging.english-academy-fl.workers.dev',
  'https://brunos-glass-mirror.english-academy-fl.workers.dev',
  ...(Deno.env.get('ADDITIONAL_ALLOWED_ORIGINS') || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
]);

const mimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const buckets = new Map<string, { count: number; until: number }>();

function reply(body: unknown, status = 200, origin = '') {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'vary': 'Origin',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers':
      'authorization, apikey, content-type, x-client-info'
  };

  if (allowedOrigins.has(origin)) {
    headers['access-control-allow-origin'] = origin;
  }

  return new Response(
    status === 204 ? null : JSON.stringify(body),
    { status, headers }
  );
}

function limited(request: Request) {
  const address =
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';

  const now = Date.now();
  const current = buckets.get(address);

  if (!current || current.until <= now) {
    buckets.set(address, { count: 1, until: now + 60_000 });
    return false;
  }

  current.count++;
  return current.count > 2;
}

function safeProviderCode(value: unknown) {
  return typeof value === 'string' && /^[a-z0-9_-]{1,80}$/i.test(value)
    ? value
    : null;
}

Deno.serve(async request => {
  const origin = request.headers.get('origin') || '';

  if (request.method === 'OPTIONS') {
    return reply({}, 204, origin);
  }

  if (request.method !== 'POST') {
    return reply({ error: 'Method not allowed.' }, 405, origin);
  }

  if (origin && !allowedOrigins.has(origin)) {
    return reply({ error: 'Origin is not allowed.' }, 403, origin);
  }

  if (limited(request)) {
    return reply(
      { error: 'Too many preview requests. Try again shortly.' },
      429,
      origin
    );
  }

  const key = Deno.env.get('OPENAI_API_KEY');

  if (!key) {
    return reply(
      { error: 'AI shower preview is not configured.' },
      503,
      origin
    );
  }

  try {
    const declared = Number(request.headers.get('content-length') || 0);

    if (declared > 11_500_000) {
      return reply(
        { error: 'Photo is too large. Choose an image up to 8 MB.' },
        413,
        origin
      );
    }

    const reader = request.body?.getReader();

    if (!reader) {
      return reply({ error: 'Photo content is required.' }, 400, origin);
    }

    const chunks: Uint8Array[] = [];
    let total = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      total += value.byteLength;

      if (total > 11_500_000) {
        await reader.cancel();
        return reply(
          { error: 'Photo is too large. Choose an image up to 8 MB.' },
          413,
          origin
        );
      }

      chunks.push(value);
    }

    const bytes = new Uint8Array(total);
    let offset = 0;

    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const raw = new TextDecoder().decode(bytes);
    const body = JSON.parse(raw);

    const match =
      typeof body?.image === 'string'
        ? body.image.match(
            /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/
          )
        : null;

    if (
      !match ||
      !mimeTypes.has(match[1]) ||
      match[2].length > 11_185_000 ||
      match[2].length % 4 !== 0
    ) {
      return reply(
        { error: 'Choose a JPG, PNG or WebP photo up to 8 MB.' },
        400,
        origin
      );
    }

    const padding = match[2].endsWith('==')
      ? 2
      : match[2].endsWith('=')
        ? 1
        : 0;

    if (match[2].length / 4 * 3 - padding > 8 * 1024 * 1024) {
      return reply(
        { error: 'Choose a JPG, PNG or WebP photo up to 8 MB.' },
        400,
        origin
      );
    }

    const configuration =
      typeof body?.configuration === 'string'
        ? body.configuration.trim()
        : '';

    const geometry =
      typeof body?.geometry === 'string'
        ? body.geometry.trim()
        : '';

    const glassType =
      typeof body?.glassType === 'string'
        ? body.glassType.trim()
        : '';

    const hardwareFinish =
      typeof body?.hardwareFinish === 'string'
        ? body.hardwareFinish.trim()
        : '';

    const handleStyle =
      typeof body?.handleStyle === 'string'
        ? body.handleStyle.trim()
        : '';

    const approvedGlassTypes = [
      'Clear Glass - 3/8',
      'Low-Iron Glass - 3/8',
      'Reeded / Moru - 3/8',
      'Satin Acid-Etched - 3/8',
      'Satin Acid-Etched Low-Iron - 3/8'
    ];

    const approvedHardwareFinishes = [
      'Brushed Gold',
      'Brushed Nickel',
      'Chrome',
      'Matte Black'
    ];

    const approvedHandleStyles = [
      'Ladder Handle',
      'Round Handle',
      'Square Handle'
    ];

    if (
      !SHOWER_CONFIGURATIONS.includes(configuration) ||
      configuration.startsWith('Not Sure')
    ) {
      return reply(
        { error: 'Choose a confirmed shower configuration first.' },
        400,
        origin
      );
    }

    if (
      !SHOWER_GEOMETRIES.includes(geometry) ||
      geometry === 'unclear' ||
      !isShowerConfigurationCompatible(geometry, configuration)
    ) {
      return reply(
        { error: 'The selected shower configuration is not compatible with this opening.' },
        400,
        origin
      );
    }

    if (
      !approvedGlassTypes.includes(glassType) ||
      !approvedHardwareFinishes.includes(hardwareFinish)
    ) {
      return reply(
        { error: 'Choose an approved glass type and hardware finish before generating a preview.' },
        400,
        origin
      );
    }

    if (handleStyle && !approvedHandleStyles.includes(handleStyle)) {
      return reply(
        { error: 'Choose an approved handle style before generating a preview.' },
        400,
        origin
      );
    }

    const imageBytes = Uint8Array.from(
      atob(match[2]),
      character => character.charCodeAt(0)
    );

    const imageBlob = new Blob(
      [imageBytes],
      { type: match[1] }
    );

    const extension =
      match[1] === 'image/png'
        ? 'png'
        : match[1] === 'image/webp'
          ? 'webp'
          : 'jpg';

    const prompt = [
      'Create a photorealistic conceptual shower-glass visualization by editing the supplied customer photo.',
      `Install only this approved Bruno's Glass shower configuration: ${configuration}.`,
      `The classified opening geometry is: ${geometry}.`,
      `Use this approved glass selection: ${glassType}.`,
      `Use this approved hardware finish: ${hardwareFinish}.`,
      ...(handleStyle ? [`Use this approved handle style: ${handleStyle}.`] : []),
      'Preserve the original photograph as faithfully as possible.',
      'Do not redesign, replace, remove, move, crop, repaint, retile, clean up, or restyle anything already present.',
      'Keep the same walls, tile, grout, curb or bathtub, floor, ceiling, niches, windows, fixtures, furniture, reflections, lighting, camera position, perspective, proportions, and visible imperfections.',
      'Only add the glass enclosure components required by the selected configuration. Match the selected approved glass appearance and hardware finish faithfully. Add a handle only when appropriate for the selected configuration and use the approved handle style when one was supplied.',
      'Keep all new glass and hardware physically aligned to the existing shower opening and perspective.',
      'Do not add dimensions, labels, logos, people, decorations, pricing, text, construction changes, or unrelated objects.',
      'Do not imply that dimensions are verified or fabrication-ready.',
      'The result is a conceptual visualization only; professional field measurement is required before fabrication.'
    ].join(' ');

    const form = new FormData();

    form.append(
      'model',
      Deno.env.get('OPENAI_IMAGE_MODEL') || 'gpt-image-2'
    );

    form.append(
      'image',
      imageBlob,
      `customer-shower.${extension}`
    );

    form.append('prompt', prompt);
    form.append('size', 'auto');
    form.append('quality', 'medium');
    form.append('output_format', 'jpeg');

    const response = await fetch(
      'https://api.openai.com/v1/images/edits',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${key}`
        },
        body: form
      }
    );

    if (!response.ok) {
      const failure: any = await response.json().catch(() => ({}));

      return reply(
        {
          error: 'AI shower preview is temporarily unavailable.',
          providerStatus: response.status,
          providerErrorType: safeProviderCode(failure?.error?.type),
          providerErrorCode: safeProviderCode(failure?.error?.code)
        },
        502,
        origin
      );
    }

    const data: any = await response.json();
    const base64 = data?.data?.[0]?.b64_json;

    if (typeof base64 !== 'string' || !base64.length) {
      return reply(
        { error: 'AI shower preview returned no usable image.' },
        502,
        origin
      );
    }

    return reply(
      {
        image: `data:image/jpeg;base64,${base64}`,
        configuration,
        geometry,
        glassType,
        hardwareFinish,
        handleStyle: handleStyle || null,
        conceptual: true
      },
      200,
      origin
    );
  } catch {
    return reply(
      { error: 'AI shower preview is temporarily unavailable.' },
      502,
      origin
    );
  }
});