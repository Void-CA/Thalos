import { inject, Injectable } from "@angular/core";
import { Observable } from "rxjs";

@Injectable({ providedIn: 'root' })
export class RobotApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = 'http://localhost:3000/api/v1';

  getRobots(): Observable<RobotMetadata[]> {
    return this.http.get<RobotMetadata[]>(
      `${this.baseUrl}/robots`
    );
  }

  getRobot(id: string): Observable<RobotMetadata> {
    return this.http.get<RobotMetadata>(
      `${this.baseUrl}/robots/${id}`
    );
  }
}