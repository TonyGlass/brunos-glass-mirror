// Single pricing formula, extracted from script.js. Internal results never leave the server.
function priceKey(label) {
  return String(label || '').toLowerCase().replaceAll('"', '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function validCostRange(cost) {
  return Number.isFinite(cost?.low) && Number.isFinite(cost?.high) && cost.low >= 0 && cost.high >= cost.low;
}

export function calculateEstimatedPrice({
  service,
  glassType,
  hardwareFinish,
  squareFeet,
  quantity,
  counts = {},
  enduroShield = false,
  mirrorFrame = false
}, config) {
  const sqft = Number(squareFeet) || 0;
  const qty = Number(quantity) || 1;
  const glassLabel = String(glassType || '').toLowerCase();
  const serviceLabel = String(service || '').toLowerCase();
  if (serviceLabel.includes('mirror') && !glassLabel.includes('mirror')) return null;
  if (!serviceLabel.includes('mirror') && glassLabel.includes('mirror')) return null;
  const tableKey = priceKey(glassLabel);
  // Final selling rates already include standard hardware, labor and margin.
  // Keep the historical cost model for mirrors and older saved configurations.
  if (config.pricingModel === 'selling-rates-v1') {
    const rate = config.finalSellingRates?.[tableKey];
    const coating = config.enduroShieldRate;
    if (!service || !Number.isFinite(rate) || rate < 0 || sqft <= 0 || qty <= 0) return null;
    if (enduroShield && (!Number.isFinite(coating) || coating < 0)) return {complete:false, missing:['enduroShieldRate']};
    const material = sqft * rate * qty;
    const frameRate = config.finalSellingRates?.['metal-frame'];
    if (serviceLabel.includes('mirror') && mirrorFrame && (!Number.isFinite(frameRate) || frameRate < 0)) return {complete:false, missing:['Metal / Frame selling rate']};
    const frame = serviceLabel.includes('mirror') && mirrorFrame ? sqft * frameRate * qty : 0;
    const coatingCharge = enduroShield ? sqft * coating * qty : 0;
    const total = material + frame + coatingCharge;
    return {complete:true, low:total, high:total, breakdown:{material,frame,enduroShield:coatingCharge}};
  }
  // Coating was not part of the historical formula; never silently omit it.
  if (enduroShield) return {complete:false, missing:['EnduroShield selling-rate configuration']};
  const glassRate = glassLabel.includes('mirror')
    ? config.mirrorCosts[tableKey]
    : config.glassCosts[tableKey];
  if (!service || !validCostRange(glassRate) || sqft <= 0 || qty <= 0) return null;

  const missing = [];
  const lowComponents = [sqft * glassRate.low];
  const highComponents = [sqft * glassRate.high];
  const splitLites = Number(counts.splitLites || 0);
  if (splitLites > 0) {
    const splitRate = config.glassLowIron38SplitPerLite.value;
    if (!Number.isFinite(splitRate) || splitRate < 0) missing.push('single-split glass');
    else {
      lowComponents.push(splitLites * splitRate);
      highComponents.push(splitLites * splitRate);
    }
  }
  for (const [key, label] of Object.entries({
    hinges: 'hinges', handles: 'handles', clips: 'clips', sweeps: 'sweeps/seals',
    channels: 'channels', accessories: 'other hardware'
  })) {
    const count = Number(counts[key] || 0);
    if (count > 0) {
      const cost = config.hardware[key];
      if (!validCostRange(cost)) missing.push(label);
      else {
        lowComponents.push(count * cost.low);
        highComponents.push(count * cost.high);
      }
    }
  }
  for (const [key, label] of Object.entries({
    fabrication: 'fabrication', installationLabor: 'installation labor',
    consumables: 'consumables', other: 'other costs'
  })) {
    const cost = config[key];
    if (!validCostRange(cost)) missing.push(label);
    else {
      lowComponents.push(cost.low);
      highComponents.push(cost.high);
    }
  }
  if (!Number.isFinite(config.profitMargin) || config.profitMargin < 0 || config.profitMargin >= 1) missing.push('margin configuration');
  if (missing.length) return { complete: false, missing };

  const totalLowCost = lowComponents.reduce((sum, cost) => sum + cost, 0) * qty;
  const totalHighCost = highComponents.reduce((sum, cost) => sum + cost, 0) * qty;
  const divisor = 1 - config.profitMargin;
  const saleLow = Math.round(totalLowCost / divisor);
  const saleHigh = Math.round(totalHighCost / divisor);
  return {
    complete: true,
    low: saleLow,
    high: saleHigh,
    internal: {
      totalCostLow: totalLowCost,
      totalCostHigh: totalHighCost,
      profitLow: saleLow - totalLowCost,
      profitHigh: saleHigh - totalHighCost,
      margin: config.profitMargin
    }
  };
}
