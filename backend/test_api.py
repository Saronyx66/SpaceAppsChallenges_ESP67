"""Fast adapter tests on the real local DTM; does not run A* or prepare cost maps."""
import math
import unittest
import rasterio
from fastapi import HTTPException
from pydantic import ValidationError
from . import api


def frontend_point(row,col):
    return api.Coordinate(x=((col+.5)*6196/1549-2.5)/6192*100,
                          y=((row+.5)*14478/3619-1.5)/14475*100)


class RouteAdapterTests(unittest.TestCase):
    def test_inputs_must_be_finite_numbers_in_the_frontend_coordinate_range(self):
        for x in (-1,101,math.inf,math.nan,"50",True):
            with self.subTest(x=x), self.assertRaises(ValidationError):
                api.Coordinate(x=x,y=50)

    def test_frontend_coordinates_map_back_to_the_correct_original_img_grid(self):
        with rasterio.open(api.routing.DTM) as src:
            for cell in ((2000,500),(2005,500),(3000,500)):
                self.assertEqual(api.point_to_cell(frontend_point(*cell),src),cell)

    def test_native_nodata_cannot_be_used_as_an_endpoint(self):
        with rasterio.open(api.routing.DTM) as src, self.assertRaises(HTTPException) as result:
            api.point_to_cell(api.Coordinate(x=0,y=0),src)
        self.assertEqual(result.exception.status_code,422)

    def test_same_cell_is_rejected_before_cost_map_preparation(self):
        point=frontend_point(2000,500)
        before=api._load_routing_data.cache_info().misses
        with self.assertRaises(HTTPException) as result:
            api.calculate_route(api.RouteRequest(start=point,goal=point))
        self.assertEqual(result.exception.status_code,422)
        self.assertEqual(api._load_routing_data.cache_info().misses,before)

    def test_busy_service_does_not_start_another_route(self):
        with api._route_lock, self.assertRaises(HTTPException) as result:
            api.calculate_route(api.RouteRequest(start=frontend_point(2000,500),goal=frontend_point(2005,500)))
        self.assertEqual(result.exception.status_code,409)


if __name__=="__main__":
    unittest.main()
