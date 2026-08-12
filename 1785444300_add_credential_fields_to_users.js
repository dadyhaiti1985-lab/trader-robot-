/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");

    if (!users.fields.getByName("platform")) {
      users.fields.add(new TextField({ name: "platform", max: 60 }));
    }
    if (!users.fields.getByName("maxRisk")) {
      users.fields.add(new NumberField({ name: "maxRisk", min: 0, max: 100 }));
    }
    if (!users.fields.getByName("stopLoss")) {
      users.fields.add(new NumberField({ name: "stopLoss", min: 0, max: 100 }));
    }
    if (!users.fields.getByName("takeProfit")) {
      users.fields.add(new NumberField({ name: "takeProfit", min: 0, max: 100 }));
    }

    app.save(users);
  },
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    users.fields.removeByName("platform");
    users.fields.removeByName("maxRisk");
    users.fields.removeByName("stopLoss");
    users.fields.removeByName("takeProfit");
    app.save(users);
  },
);
