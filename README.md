# Canada Fraud Watch

This is an interactive data visualization dashboard designed to help users understand the landscape of fraud in Canada. Developed for the **UW-Madison GEOG 575 (Fall 2025)** course, this project visualizes trends, demographics, and regional differences in fraud reporting using [Canadian Anti-Fraud Centre Reporting Data](https://open.canada.ca/data/en/dataset/6a09c998-cddb-4a22-beff-4dca67ab892f/resource/43c67af5-e598-4a9b-a484-fe1cb5d775b5).

## 👥 Team Members

* **Eugenie Huang**  
* **Elijah Gardner Woods**  
* **Darbie Gibbs**

## 🛠️ Tech Stack

* **Core:** HTML5, CSS3, JavaScript (ES6+)
* **Visualization:** [D3.js (v7)](https://d3js.org/)
* **Mapping:** [TopoJSON Client](https://github.com/topojson/topojson-client)
* **Styling & Layout:** [Bootstrap 5](https://getbootstrap.com/)
* **Fonts:** Google Fonts (Exo 2, Josefin Slab)
* **Utilities:** jQuery

## 📂 Data Sources

This project utilizes public data from Canadian government agencies:
* **Fraud Data:** Canadian Anti-Fraud Centre Reporting Data.
* **Geospatial Data:** Statistics Canada / Natural Resources Canada (Province Boundaries).
* **Legislation:** Department of Justice Canada (Criminal Code Section 380).

## 📦 Setup & Usage

Since this project uses D3.js to fetch external data files (JSON/GeoJSON), it requires a local web server to avoid CORS (Cross-Origin Resource Sharing) errors.

1.  **Clone the repository:**
    ```bash
    git clone [https://github.com/cat-grep/CanadaFraudWatch.git](https://github.com/cat-grep/CanadaFraudWatch.git)
    cd canada-fraud-watch
    ```

2.  **Start a local server:**
    * **Using Python:**
        ```bash
        # Python 3
        python -m http.server 8000
        ```
    * **Using VS Code:**
        Install the "Live Server" extension and click "Go Live" at the bottom right.

3.  **View the App:**
    Open your browser and navigate to `http://localhost:8000`.