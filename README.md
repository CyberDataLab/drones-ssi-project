# 🚁 SSI Architecture for Drones & AI Data Ingestion



This project acts as a **Proof of Concept (PoC)** for a Master's Thesis (TFM). It implements a **Self-Sovereign Identity (SSI)** architecture to secure the data ingestion pipeline from IoT devices (Drones) to AI training datasets.

The system ensures that only authorized devices with valid **Verifiable Credentials (VCs)** can contribute data to the system, preventing data poisoning and ensuring integrity.

## 📦 Project Structure

The project is organized as a monorepo with three main packages:

* **`packages/shared`**: Common cryptographic kernel and Veramo agent configuration.
* **`packages/server` (Verifier)**: receives telemetry, verifies credentials, and saves valid data to a CSV dataset.
* **`packages/authority` (Issuer)**: trusted entity that issues flight licenses (VCs).
* **`packages/drone` (Holder/Prover)**: IoT device that holds the license and signs telemetry data.

---

## 📋 Prerequisites

* **Node.js**: Version 18 or higher.
* **Git**: To clone the repository.

---

## ⚙️ 1. Installation

Since this is a monorepo, you must install dependencies in a specific order. Open a terminal in the project root:

### Step A: Build the Shared Kernel
This is critical. The shared library must be built before the agents can run.

```bash
cd packages/shared
npm install
npm run build
```

### Step B: Install Agents
Install dependencies for the three individual components:

```bash
# Install Server
cd server
npm install

# Install Authority
cd authority
npm install

# Install Drone
cd drone
npm install
```

## 🚀 2. Quick Start Guide

To run the full ecosystem, you will need 3 separate terminal windows.

### 🖥️ TERMINAL 1: The Infrastructure (Server)
The server must be running to receive data.

```bash
# Navigate to the server folder
cd packages/server

# Start the server
npm start
```
⚠️ IMPORTANT: The server will display its DID (Decentralized Identifier).
* **Example**: `did:key:z6Mk...`
* **Copy this DID**. You will need it to configure the drone.
* Keep this terminal open.

### 🚁 TERMINAL 2: Drone Provisioning (Setup)
We simulate unboxing a new drone. It needs to geerate its identity and be configured.

```bash
# Navigate to the drone folder
cd packages/drone

# Run the setup wizard
npm run setup
```
⚠️ IMPORTANT: The script will generate a new DID for the drone.
* **Copy the Drone DID** displayed on the screen.
* **DO NOT close this terminal**. The script is paused, waiting for you to get a license.

### 🏛️ TERMINAL 3: Issuing the License (Authority)
The Authority certifies the drone.

```bash
# Navigate to the authority folder
cd packages/authority

# Run the issuer agent
npm start
```

⚠️ IMPORTANT: It will ask for the **Drone DID**. Paste the DID you copied in **Terminal 2**. Then, copy the entire **JWT String** generated.

### 🏁 Finalizing Configuration
Go back to **TERMINAL 2** (where the Drone setup is paused).

* Paste the **SERVER DID** (from Terminal 1).
* Paste the **License JWT** (from Terminal 3).
* The system will verify and save the configuration.

## 📡 3. Operation (Flight)
Now that the drone is provisioned and licensed, it can operate autonomously.

In **Terminal 2** (packages/drone), run:
```bash
npm start
```
**Expected Output**
* **Drone**: It will load its identity and license from the local database, sign the telemetry, and send it to the server.
* **Server**: It will receive the message, cryptographically verify the license, and if valid, append the data to *drones-dataset.csv*