export function buildDemoImages(origin) {
  return [
    {
      id: "demo-camera",
      answer: "camera",
      acceptedAnswers: ["photography camera"],
      imageUrl: `${origin}/assets/demo/camera.svg`,
      source: "demo",
      focusX: 50,
      focusY: 50,
    },
    {
      id: "demo-coffee",
      answer: "coffee",
      acceptedAnswers: ["coffee mug", "mug"],
      imageUrl: `${origin}/assets/demo/coffee.svg`,
      source: "demo",
      focusX: 50,
      focusY: 52,
    },
    {
      id: "demo-backpack",
      answer: "backpack",
      acceptedAnswers: ["bag", "school bag"],
      imageUrl: `${origin}/assets/demo/backpack.svg`,
      source: "demo",
      focusX: 50,
      focusY: 52,
    },
    {
      id: "demo-headphones",
      answer: "headphones",
      acceptedAnswers: ["headset"],
      imageUrl: `${origin}/assets/demo/headphones.svg`,
      source: "demo",
      focusX: 50,
      focusY: 52,
    },
  ];
}
