const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const { test, before, after, beforeEach } = require("node:test");
const fs = require("node:fs");

let testEnv;
const PROJECT_ID = process.env.GCP_PROJECT || "demo-no-project";
const ALICE_UID = "alice_uid_123";
const BOB_UID = "bob_uid_456";
const WORLD_ID = "world_001";

const [emulatorHost, emulatorPortStr] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8085").split(":");
const emulatorPort = parseInt(emulatorPortStr, 10);

before(async () => {
  const rules = fs.readFileSync("./firestore.rules", "utf8");
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules,
      host: emulatorHost,
      port: emulatorPort,
    },
  });
});

after(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

beforeEach(async () => {
  if (testEnv) {
    await testEnv.clearFirestore();
  }
});

function validWorldPayload(uid, now) {
  return {
    userId: uid,
    name: "アストレア",
    starType: "主系列G型星",
    description: "黄金の大陸と結晶海を持つ新星",
    currentYear: 1,
    eraName: "創世紀",
    gridWidth: 16,
    gridHeight: 12,
    terrainTiles: [101, 202, 305],
    nationGrid: ["", "nat_1", ""],
    visualTheme: "CELESTIAL_ASTROLABE",
    createdAt: now,
    updatedAt: now,
  };
}

test("Unauthenticated user cannot list, read, or write worlds or subcollections", async () => {
  const unauthDb = testEnv.unauthenticatedContext().firestore();
  const now = new Date(Date.now() - 2000);
  await assertFails(unauthDb.collection("users").doc(ALICE_UID).collection("worlds").get());
  await assertFails(
    unauthDb.collection("users").doc(ALICE_UID).collection("worlds").doc(WORLD_ID).set(validWorldPayload(ALICE_UID, now))
  );
  await assertFails(
    unauthDb.collection("users").doc(ALICE_UID).collection("worlds").doc(WORLD_ID).collection("elements").get()
  );
});

test("Owner can create, update, and list worlds; cross-user access and invalid mutations fail", async () => {
  const aliceDb = testEnv.authenticatedContext(ALICE_UID).firestore();
  const bobDb = testEnv.authenticatedContext(BOB_UID).firestore();
  const now = new Date(Date.now() - 5000);

  const worldRef = aliceDb.collection("users").doc(ALICE_UID).collection("worlds").doc(WORLD_ID);
  await assertSucceeds(worldRef.set(validWorldPayload(ALICE_UID, now)));
  await assertSucceeds(aliceDb.collection("users").doc(ALICE_UID).collection("worlds").get());

  // Partial update on allowed mutable keys succeeds
  await assertSucceeds(
    worldRef.update({
      currentYear: 120,
      visualTheme: "PARCHMENT_MAP",
      updatedAt: new Date(Date.now() - 1000),
    })
  );

  // Reject ghost field / shadow update
  await assertFails(
    worldRef.update({
      isAdmin: true,
      updatedAt: new Date(Date.now() - 1000),
    })
  );

  // Reject immutable createdAt modification
  await assertFails(
    worldRef.update({
      createdAt: new Date(Date.now() - 500),
      updatedAt: new Date(Date.now() - 500),
    })
  );

  // Reject future timestamp
  await assertFails(
    aliceDb.collection("users").doc(ALICE_UID).collection("worlds").doc("world_future").set(
      validWorldPayload(ALICE_UID, new Date(Date.now() + 60000))
    )
  );

  // Reject @DocumentId `id` field in payload
  const badPayload = { ...validWorldPayload(ALICE_UID, now), id: "world_with_id" };
  await assertFails(
    aliceDb.collection("users").doc(ALICE_UID).collection("worlds").doc("world_with_id").set(badPayload)
  );

  // Cross-user isolation: Bob cannot read or write Alice's world
  await assertFails(bobDb.collection("users").doc(ALICE_UID).collection("worlds").doc(WORLD_ID).get());
  await assertFails(bobDb.collection("users").doc(ALICE_UID).collection("worlds").get());
  await assertFails(
    bobDb.collection("users").doc(ALICE_UID).collection("worlds").doc(WORLD_ID).update({
      name: "Hijacked",
      updatedAt: new Date(Date.now() - 1000),
    })
  );
});

test("Owner can CRUD all world-building subcollections with strict schema parity", async () => {
  const aliceDb = testEnv.authenticatedContext(ALICE_UID).firestore();
  const bobDb = testEnv.authenticatedContext(BOB_UID).firestore();
  const now = new Date(Date.now() - 5000);

  const worldRef = aliceDb.collection("users").doc(ALICE_UID).collection("worlds").doc(WORLD_ID);
  await assertSucceeds(worldRef.set(validWorldPayload(ALICE_UID, now)));

  // Element
  await assertSucceeds(
    worldRef.collection("elements").doc("el_1").set({
      userId: ALICE_UID,
      worldId: WORLD_ID,
      name: "星輝鉄",
      symbol: "As",
      atomicNumber: 42,
      category: "金属",
      volatility: 15,
      abundance: 60,
      colorHex: 0xFFE5B84B,
      traits: "魔力伝導性が高い",
      compoundFormula: "",
      createdAt: now,
      updatedAt: now,
    })
  );

  // Ecosystem & Species
  await assertSucceeds(
    worldRef.collection("ecosystems").doc("eco_1").set({
      userId: ALICE_UID,
      worldId: WORLD_ID,
      name: "翡翠樹海",
      biomeType: "森林",
      climate: "温暖湿潤",
      stability: 85,
      foodWebSummary: "光合成樹から翼獣へ循環",
      keyResource: "星輝鉄",
      createdAt: now,
      updatedAt: now,
    })
  );

  await assertSucceeds(
    worldRef.collection("species").doc("sp_1").set({
      userId: ALICE_UID,
      worldId: WORLD_ID,
      ecosystemId: "eco_1",
      name: "蒼翼鹿",
      trophicRole: "草食",
      population: 1400,
      traits: "角が星光を蓄える",
      appearance: "蒼い毛並みと半透明の角",
      createdAt: now,
      updatedAt: now,
    })
  );

  // Language & Writing Script
  await assertSucceeds(
    worldRef.collection("languages").doc("lang_1").set({
      userId: ALICE_UID,
      worldId: WORLD_ID,
      name: "ソラリス語",
      wordOrder: "SOV",
      vowels: "a,e,i,o,u",
      consonants: "k,s,t,n,r,l",
      syllablePattern: "CV",
      scriptName: "星象文字",
      scriptType: "表音文字",
      writingDirection: "LTR",
      lexiconEntries: ["sora=空", "lum=星", "tara=水"],
      glyphStrokes: ["a|0.2,0.8-0.5,0.2-0.8,0.8"],
      sampleSentence: "sora lum tara",
      createdAt: now,
      updatedAt: now,
    })
  );

  // Culture & Religion
  await assertSucceeds(
    worldRef.collection("cultures").doc("cul_1").set({
      userId: ALICE_UID,
      worldId: WORLD_ID,
      name: "星詠み文化",
      languageId: "lang_1",
      ethos: "観測と調和",
      architectureStyle: "白石の円形天文台",
      cuisine: "星露茶と焼穀物",
      festival: "双星祭",
      greeting: "Lum sora!",
      createdAt: now,
      updatedAt: now,
    })
  );

  await assertSucceeds(
    worldRef.collection("religions").doc("rel_1").set({
      userId: ALICE_UID,
      worldId: WORLD_ID,
      name: "星辰教",
      cosmologyType: "汎神論",
      deityConcept: "万物を結ぶ光の織手",
      tenets: "記録を残し生態を敬う",
      rituals: "新月の夜に文字を刻む",
      creationMyth: "虚無に落ちた星輝鉄から大地が芽吹いた",
      emblemSides: 6,
      emblemColorHex: 0xFFF4C95D,
      createdAt: now,
      updatedAt: now,
    })
  );

  // Nation, Village, People, Chronicle
  await assertSucceeds(
    worldRef.collection("nations").doc("nat_1").set({
      userId: ALICE_UID,
      worldId: WORLD_ID,
      name: "アルカディア連邦",
      governmentType: "賢人評議会",
      cultureId: "cul_1",
      religionId: "rel_1",
      languageId: "lang_1",
      colorHex: 0xFF38BDF8,
      motto: "星を記し、土を耕す",
      diplomacyNote: "交易を重視する海洋国家",
      createdAt: now,
      updatedAt: now,
    })
  );

  await assertSucceeds(
    worldRef.collection("villages").doc("vil_1").set({
      userId: ALICE_UID,
      worldId: WORLD_ID,
      nationId: "nat_1",
      name: "ルミナ村",
      mapX: 5,
      mapY: 4,
      population: 320,
      prosperity: 65,
      specialty: "天文観測と星輝鉄細工",
      districtCells: ["2,2:PLAZA:1:中央星広場", "2,3:TEMPLE:1:星辰神殿"],
      createdAt: now,
      updatedAt: now,
    })
  );

  await assertSucceeds(
    worldRef.collection("people").doc("per_1").set({
      userId: ALICE_UID,
      worldId: WORLD_ID,
      villageId: "vil_1",
      nationId: "nat_1",
      name: "セレン・ソラ",
      age: 24,
      role: "書記官",
      districtType: "SCRIPTORIUM",
      traits: "好奇心旺盛・几帳面",
      faith: "星辰教",
      biography: "星象文字の最初の辞書を編纂した。",
      createdAt: now,
      updatedAt: now,
    })
  );

  await assertSucceeds(
    worldRef.collection("chronicles").doc("chr_1").set({
      userId: ALICE_UID,
      worldId: WORLD_ID,
      year: 1,
      category: "創世",
      title: "第一の星火が灯る",
      summary: "星輝鉄が地表に降り注ぎ、最初の生態系が芽吹いた。",
      createdAt: now,
      updatedAt: now,
    })
  );

  // Bob cannot list or read Alice's subcollections
  await assertFails(bobDb.collection("users").doc(ALICE_UID).collection("worlds").doc(WORLD_ID).collection("elements").get());
  await assertFails(bobDb.collection("users").doc(ALICE_UID).collection("worlds").doc(WORLD_ID).collection("villages").get());

  // Bounds check: invalid emblemSides (<3) fails
  await assertFails(
    worldRef.collection("religions").doc("rel_bad").set({
      userId: ALICE_UID,
      worldId: WORLD_ID,
      name: "不正宗派",
      cosmologyType: "一神教",
      deityConcept: "",
      tenets: "",
      rituals: "",
      creationMyth: "",
      emblemSides: 2,
      emblemColorHex: 0xFFFFFFFF,
      createdAt: now,
      updatedAt: now,
    })
  );
});
