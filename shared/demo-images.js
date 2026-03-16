export function buildDemoImages(origin) {
  return [
    {
      id: "demo-watcard",
      answer: "WatCard",
      acceptedAnswers: ["wat card"],
      imageUrl: `${origin}/assets/demo/camera.svg`,
      source: "demo",
      focusX: 50,
      focusY: 50,
    },
    {
      id: "demo-dana-porter",
      answer: "Dana Porter Library",
      acceptedAnswers: ["Dana Porter", "DP Library", "DP"],
      imageUrl: `${origin}/assets/demo/coffee.svg`,
      source: "demo",
      focusX: 50,
      focusY: 48,
    },
    {
      id: "demo-goose",
      answer: "goose",
      acceptedAnswers: ["geese"],
      imageUrl: `${origin}/assets/demo/backpack.svg`,
      source: "demo",
      focusX: 50,
      focusY: 52,
    },
    {
      id: "demo-ion",
      answer: "ION",
      acceptedAnswers: ["ION train", "LRT"],
      imageUrl: `${origin}/assets/demo/headphones.svg`,
      source: "demo",
      focusX: 50,
      focusY: 52,
    },
  ];
}
