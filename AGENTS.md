# Agent Instructions

## Repository purpose
This repository is an Expo and React Native demo application for Phantom's deep-linking API.

## Layout
- `App.tsx`: primary application UI and deep-link workflow.
- `constants/`: application constants used by the demo.
- `app.json`: Expo app identity, scheme, and platform package configuration.
- `eas.json`: EAS build configuration.
- `assets/`: application images and other static assets.

## Development commands
Use Node.js 18 or later.

- `yarn`: install dependencies.
- `yarn watch`: start Expo with the development client and a cleared cache.
- `yarn watch:tunnel`: start the development client through an Expo tunnel.
- `yarn android`: run the Android app.
- `yarn ios`: run the iOS app.
- `yarn lint`: lint the repository.
- `yarn build-android`: create a local production Android build with EAS.

The package does not define an automated test command.

## Contribution constraints
- Keep deep-link behavior aligned with the Phantom deep-link API documentation linked from `README.md`.
- Preserve the configured `deep-link-demo-app` URL scheme unless the app identity and deep-link setup are intentionally migrated together.
- Keep Expo, iOS bundle identifier, and Android package changes coordinated in `app.json`.
