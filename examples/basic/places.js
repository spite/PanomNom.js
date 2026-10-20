// Street View panoramas to try, with where they were taken. All of them have depth data.
const PANORAMAS = [
  ["kCisB_W6mNaYBgdxg0AX8A", "King's Cross", 51.531618, -0.125108],
  ["3toTZ-zA0QH6HRfvol1QPA", "Central Park", 40.790883, -73.963647],
  ["ywskIOsAFskiKHt5fwIUWA", "Times Square", 40.758003, -73.985568],
  ["Y6QmZI-mQsESy8rfUxECCA", "Eiffel Tower", 48.855927, 2.298106],
  ["V9Rj0nXkFLHvUFpZcgePKw", "Piazza San Marco", 45.433827, 12.33891],
  ["Z47FwC7ICZVNc2M7rWmIMg", "Colosseum", 41.890017, 12.491986],
  ["31kMblUiNIsRaFncGLjzYA", "Sagrada Família", 41.403335, 2.174441],
  ["2goFknGi9X7-XBWq1tHkBw", "Sydney Opera House", -33.858024, 151.214494],
  ["ZtoPENLuyS3jxl5XfAieTw", "Machu Picchu", -13.163068, -72.544984],
  ["DcQibuoY3yH3B_j8GHDMgw", "Petra", 30.322194, 35.451637],
  ["nkcRgDHBNq6Mfaqvo4JmyQ", "Copacabana", -22.971484, -43.181865],
  ["i0BnBFVNYD0u-LjaPfT_Ig", "Taj Mahal", 27.173713, 78.041996],
];

// Spots to search around for the nearest panorama.
const LOCATIONS = [
  ["51.50701,-0.12792", "London"],
  ["41.41342,2.15311", "Barcelona"],
  ["50.09072,14.39313", "Prague"],
  ["35.69144,139.69514", "Tokyo"],
  ["40.75800,-73.98555", "New York"],
  ["48.85593,2.29811", "Paris"],
  ["45.43383,12.33891", "Venice"],
  ["41.89002,12.49199", "Rome"],
  ["-33.85802,151.21449", "Sydney"],
  ["-22.97148,-43.18187", "Rio de Janeiro"],
  ["-13.16307,-72.54498", "Machu Picchu"],
  ["30.32219,35.45164", "Petra"],
  ["27.17371,78.04200", "Agra"],
  ["63.53186,-19.51062", "Iceland"],
  ["28.24039,-16.62999", "Tenerife"],
  ["59.30572,4.87940", "Norway"],
  ["39.36383,8.43122", "Sardinia"],
  ["54.55208,-3.29738", "Lake District"],
  ["32.61444,-108.98520", "New Mexico"],
];

// Newer photo spheres, with who shot them.
const PHOTO_SPHERES = [
  ["CIHM0ogKEICAgIDCqvKvNg", "Matterhorn", 45.97657, 7.65845, "Ferrari Francesco"],
  ["CIHM0ogKEICAgIDE59zRiAE", "Uluru", -25.34443, 131.03688, "Neil Creek"],
  ["CIHM0ogKEICAgID4y93XVg", "Santorini", 36.46182, 25.37531, "Michael Cheng"],
  ["CIHM0ogKEICAgIDMmPig8gE", "Mont-Saint-Michel", 48.63608, -1.51149, "Isaac González"],
  ["CIHM0ogKEICAgIC4i4OQxwE", "Iguazu Falls", -25.69536, -54.44088, "Alan Facundo Navarreta"],
  ["CIHM0ogKEICAgIDWjImbqQE", "Antelope Canyon", 36.86178, -111.374, "Jackson Dahn"],
  ["CIHM0ogKEICAgIDfjOedvQE", "Ha Long Bay", 20.91005, 107.1839, "Flycam QN"],
  ["CIHM0ogKEICAgICkip_hhAE", "Salar de Uyuni", -20.13378, -67.48913, "Benoît L'Heureux"],
  ["CIHM0ogKEICAgICcn7HgZQ", "Lofoten", 68.24023, 13.62053, "Viktor Posnov"],
  ["CIHM0ogKEICAgID42o_-cw", "Giant's Causeway", 55.24045, -6.50844, "Alex Comerford"],
  ["CIHM0ogKEICAgIDWrJHI1wE", "Victoria Falls", -17.9243, 25.8572, "Étienne Robin-Champigneul"],
  ["CIHM0ogKEICAgIDei5yQKg", "Torres del Paine", -50.94233, -73.40679, "Peter Kostolanský"],
  ["CIHM0ogKEICAgIC6tpCwngE", "Plitvice", 44.85245, 15.58329, "Dan Noz"],
  ["CIHM0ogKEICAgIC4_Z73pQE", "Hallstatt", 47.56222, 13.64931, "Luis Rodríguez"],
  ["CIHM0ogKEICAgIDcxd2IUg", "Park Güell", 41.4145, 2.1527, "Giorgio Diedolo"],
];

// The address Google Maps uses for a panorama, as you'd copy it from the browser.
function mapsURL([id, , lat, lng]) {
  return `https://www.google.com/maps/@${lat},${lng},3a,75y,0h,90t/data=!3m4!1e1!3m2!1s${id}!2e0`;
}

// The same for a photo sphere, which Maps marks as entity kind 10.
function photoSphereMapsURL([id, , lat, lng]) {
  return `https://www.google.com/maps/@${lat},${lng},3a,75y,0h,90t/data=!3m4!1e1!3m2!1s${id}!2e10`;
}

export { PANORAMAS, LOCATIONS, PHOTO_SPHERES, mapsURL, photoSphereMapsURL };
