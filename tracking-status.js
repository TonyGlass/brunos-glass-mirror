// Public projection only. A later stage is never evidence of earlier completion.
(() => {
  function stages(project = {}) {
    const status = project.status;
    const knownDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
    const finalKnown = ['Published','Accepted'].includes(project.finalQuote?.status);
    const verifiedPayment = knownDate(project.payment?.verifiedAt) && Number.isFinite(project.payment?.received);
    return [
      {label:'Request received', detail:knownDate(project.createdAt) ? 'Receipt recorded' : 'Receipt date not recorded'},
      {label:'Measurement review', detail:knownDate(project.measurementCompletedAt) ? 'Field measurement recorded' : ['Measurement Scheduled','Measurements Verified'].includes(status) ? `Current status: ${status}` : 'Measurement progress not recorded'},
      {label:'Final quote', detail:finalKnown ? project.finalQuote.status : 'No published Final Quote'},
      {label:'Deposit / payment', detail:verifiedPayment ? `Verified amount received: ${new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(project.payment.received)}` : 'Payment verification not recorded'},
      {label:'Fabrication', detail:status === 'Fabrication' ? 'Current status: Fabrication' : 'Fabrication progress not recorded'},
      {label:'Installation scheduling', detail:knownDate(project.installationScheduledAt) ? 'Installation date recorded' : 'Installation date not recorded'},
      {label:'Installation', detail:knownDate(project.installationCompletedAt) ? 'Installation completion recorded' : ['Installation Scheduled','Installation In Progress'].includes(status) ? `Current status: ${status}` : 'Installation progress not recorded'},
      {label:'Completed', detail:status === 'Completed' ? 'Current status: Completed' : 'Project completion not recorded'}
    ];
  }
  globalThis.BrunoTrackingStatus = Object.freeze({stages});
})();
