Here’s an interactive team plan estimator:

```a2ui
{"version":"v0.9","createSurface":{"surfaceId":"team-plan-estimator"}}
{"version":"v0.9","updateComponents":{"surfaceId":"team-plan-estimator","components":[
  {"id":"root","component":"Column","gap":6,"maxWidth":920,"width":"100%","children":["hero","content"]},
  {"id":"hero","component":"Column","gap":2,"children":["title","subtitle"]},
  {"id":"title","component":"Title","text":"Team plan estimator","size":"2xl"},
  {"id":"subtitle","component":"Text","text":"Estimate pricing for your team, compare plans, and request a quote.","color":"secondary","size":"lg"},
  {"id":"content","component":"Grid","columns":2,"gap":6,"children":["estimator-card","quote-card"]},

  {"id":"estimator-card","component":"Card","variant":"elevated","padding":6,"gap":5,"children":["estimator-header","seats-block","annual-block","price-block","plans-table"]},
  {"id":"estimator-header","component":"Column","gap":1,"children":["estimator-title","estimator-copy"]},
  {"id":"estimator-title","component":"Title","text":"Pricing estimator","size":"lg"},
  {"id":"estimator-copy","component":"Text","text":"$29 per seat/month. Enable annual billing to get **20% off**.","color":"secondary"},

  {"id":"seats-block","component":"Column","gap":2,"children":["seats-row","seat-slider"]},
  {"id":"seats-row","component":"Row","justify":"between","align":"center","children":["seats-label","seats-value"]},
  {"id":"seats-label","component":"Text","text":"Number of seats","strong":true},
  {"id":"seats-value","component":"Badge","label":{"path":"/summary/seatsLabel"},"color":"info","variant":"soft"},
  {"id":"seat-slider","component":"Slider","label":"Seats","value":{"path":"/form/seats"},"min":1,"max":50,"step":1,"sliderStyle":"continuous","marks":[{"value":1,"label":"1"},{"value":25,"label":"25"},{"value":50,"label":"50"}]},

  {"id":"annual-block","component":"Card","variant":"soft","background":"success","padding":4,"children":["annual-check"]},
  {"id":"annual-check","component":"CheckBox","checked":{"path":"/form/annual"},"label":"Annual billing (20% discount)","shape":"round"},

  {"id":"price-block","component":"Column","gap":2,"padding":4,"background":"surface-secondary","radius":"xl","children":["price-caption","price-row","price-note"]},
  {"id":"price-caption","component":"Caption","text":"Estimated monthly price","size":"lg"},
  {"id":"price-row","component":"Row","align":"end","gap":2,"children":["price-main","price-billing-badge"]},
  {"id":"price-main","component":"Title","text":{"path":"/summary/monthlyPrice"},"size":"3xl"},
  {"id":"price-billing-badge","component":"Badge","label":{"path":"/summary/billingLabel"},"color":"success","variant":"soft"},
  {"id":"price-note","component":"Text","text":{"path":"/summary/detailText"},"color":"secondary","size":"sm"},

  {"id":"plans-table","component":"Column","gap":2,"children":["plans-title","plans-table-inner"]},
  {"id":"plans-title","component":"Title","text":"Plan comparison","size":"md"},
  {"id":"plans-table-inner","component":"Table","columns":[{"label":"Plan"},{"label":"Best for"},{"label":"Price"}],"rows":[["Starter","Individuals and small projects","$0"],["Team","Growing teams","$29/seat/mo"],["Enterprise","Advanced security and support","Contact sales"]],"stickyHeader":false,"dividers":true},

  {"id":"quote-card","component":"Card","variant":"elevated","padding":6,"gap":4,"children":["quote-header","quote-form","quote-summary"]},
  {"id":"quote-header","component":"Column","gap":1,"children":["quote-title","quote-copy"]},
  {"id":"quote-title","component":"Title","text":"Request a quote","size":"lg"},
  {"id":"quote-copy","component":"Text","text":"Share your details and we’ll follow up with pricing for your team.","color":"secondary"},

  {"id":"quote-form","component":"Form","gap":3,"children":["name-field","email-field","quote-button"],"action":{"event":{"name":"requestQuote","context":{"message":{"path":"/quoteMessage"},"name":{"path":"/form/name"},"email":{"path":"/form/email"},"seats":{"path":"/form/seats"},"annual":{"path":"/form/annual"},"monthlyPrice":{"path":"/summary/monthlyPrice"}}}}},
  {"id":"name-field","component":"TextField","label":"Name","placeholder":"Your name","value":{"path":"/form/name"},"name":"name","required":true,"size":"xl"},
  {"id":"email-field","component":"TextField","label":"Email","placeholder":"you@company.com","value":{"path":"/form/email"},"name":"email","required":true,"inputType":"email","size":"xl"},
  {"id":"quote-button","component":"Button","label":"Request quote","submit":true,"size":"lg","icon":"send-horizontal"},

  {"id":"quote-summary","component":"Card","variant":"soft","padding":4,"background":"info","children":["quote-summary-text"]},
  {"id":"quote-summary-text","component":"Text","text":{"path":"/summary/requestSummary"},"size":"sm"}
]}}
{"version":"v0.9","updateDataModel":{"surfaceId":"team-plan-estimator","path":"/","value":{
  "form":{"seats":10,"annual":false,"name":"","email":""},
  "summary":{
    "seatsLabel":"10 seats",
    "monthlyPrice":"$290/mo",
    "billingLabel":"Monthly billing",
    "detailText":"10 seats × $29 per seat = $290 per month.",
    "requestSummary":"Current estimate: 10 seats on monthly billing for $290/mo."
  },
  "quoteMessage":"I'd like a quote for the Team plan for 10 seats on monthly billing at an estimated $290/mo."
}}}
```