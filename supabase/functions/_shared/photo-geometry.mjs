export const SHOWER_GEOMETRIES=Object.freeze(['straight_tub_alcove','straight_shower_opening','corner_90','neo_angle','unclear']);
export const SHOWER_CONFIGURATIONS=Object.freeze(['Sliding Door','Swing Door + Fixed Panel','90° Corner','Fixed Panel / Walk-In','Tub Enclosure','Not Sure / Let Bruno’s recommend it']);
export const GEOMETRY_CONFIDENCE_MINIMUM=0.65;
export const NOT_SURE_CONFIGURATION=SHOWER_CONFIGURATIONS[5];

// These are catalog-backed families in priority order. Neo-angle has no
// matching Bruno product in the current catalog, so it deliberately falls back.
const recommendationsByGeometry=Object.freeze({
  straight_tub_alcove:Object.freeze(['Tub Enclosure','Sliding Door']),
  straight_shower_opening:Object.freeze(['Sliding Door','Swing Door + Fixed Panel','Fixed Panel / Walk-In']),
  corner_90:Object.freeze(['90° Corner']),
  neo_angle:Object.freeze([]),
  unclear:Object.freeze([])
});
const compatibility=Object.freeze(Object.fromEntries(Object.entries(recommendationsByGeometry)
  .map(([geometry,configurations])=>[geometry,new Set([...configurations,NOT_SURE_CONFIGURATION])])));

function defaultReason(geometry,configuration) {
  const label=geometry==='straight_tub_alcove'?'straight bathtub / alcove':
    geometry==='straight_shower_opening'?'straight shower opening':'90° corner opening';
  return `${configuration} is a catalog option for a ${label}. Bruno must confirm the layout and clearances.`;
}

export function constrainShowerRecommendations({geometry,geometryConfidence,recommendations=[]}={}) {
  const confidence=Number.isFinite(geometryConfidence)&&geometryConfidence>=0&&geometryConfidence<=1?geometryConfidence:0;
  const known=SHOWER_GEOMETRIES.includes(geometry)&&geometry!=='unclear'&&confidence>=GEOMETRY_CONFIDENCE_MINIMUM;
  const safeGeometry=known?geometry:'unclear';
  if(!known) return {geometry:'unclear',geometryConfidence:confidence,recommendations:[{
    configuration:NOT_SURE_CONFIGURATION,
    reason:'The opening geometry is unclear in this photo. Bruno can review it with you.'
  }]};
  const allowed=compatibility[safeGeometry];
  const rankedConfigurations=recommendationsByGeometry[safeGeometry];
  const modelRecommendations=new Map((Array.isArray(recommendations)?recommendations:[])
    .filter(item=>item&&allowed.has(item.configuration)&&item.configuration!==NOT_SURE_CONFIGURATION)
    .map(item=>[item.configuration,typeof item.reason==='string'&&item.reason.trim()?item.reason.trim().slice(0,300):'']));
  // Filter to the geometry family first, then use the Bruno catalog priority.
  // Fill compatible family options when the model omitted one or ranked an
  // incompatible layout first. No product is invented by this fallback.
  const safe=rankedConfigurations.map(configuration=>({
    configuration,
    reason:modelRecommendations.get(configuration)||defaultReason(safeGeometry,configuration)
  })).slice(0,3);
  if(!safe.length) safe.push({configuration:NOT_SURE_CONFIGURATION,reason:'This geometry has no confirmed compatible catalog mapping yet. Bruno can review the photo with you.'});
  return {geometry:safeGeometry,geometryConfidence:confidence,recommendations:safe};
}

export function isShowerConfigurationCompatible(geometry,configuration) {
  return Boolean(compatibility[geometry]?.has(configuration));
}
